# War Engine changelog

## v9.27.0 (Out of the hole, and trucks and horses over real land)

- **Trucks driven by their crew cross real land.** A truck with soldiers at the wheel following you over natural
  terrain never moved: its physics ran it into the first slope, bank or tree, and after 20 s the crew got out and
  walked (if they hadn't suffocated in their seats against the bank first). Now it drives along your trail, over the
  land as it lies: up one-block rises, down drops of up to three, pushing through leaves, never into water or off a
  cliff. Stuck, it backs out and tries again; at a ledge it can't take it's put a little further along your trail; wedged
  in a gully it's set down where it fits. 150 blocks over hills: about 20 blocks behind you on average, with you within
  a few seconds of you stopping (it never got there before), the whole crew still aboard.
- **Soldiers in a seat don't suffocate.** Riding a vehicle or a mount pressed against a wall, a soldier took suffocation
  damage until he died.
- **Mounted followers ride your trail.** On rough land one or two horses in every group stuck on a bank and fell 100+
  blocks behind; now they ride the way you went, and a horse that can't get on is put a little further along it.
  Worst gap 110 -> about 50 blocks, every rider arrives.
- **Men climb out of holes.** A soldier who ended up in a pit with sheer sides (a natural hole, a ravine floor, a crater,
  a dip under a dark-oak canopy) and had somewhere to be never got out: the route search failed over and over and the
  rescue never came. Now, after five seconds of getting nowhere, walled in two blocks high or more on nearly every side,
  he climbs the wall to the nearest place to stand on the rim, on the side nearest where he's going (holes 2, 3 and 5
  deep: out in 14-36 s, then on to his objective). Not while he's fighting from it: a hole is cover.
- Checked: 40 soldiers fighting over real hills and forest run at 19 TPS on the test server.

## v9.26.0 (Following you over real land, hills, snow, and battle learning you can see)

Tested again on a real generated world (hills, dark forests, snowy mountains, swamps), with your followers, attacks on
hilltops and two squads meeting in the open.

- **Men following you keep up.** Over rough land they used to fall 30-60 blocks behind you: each man worked out a route
  to a place that kept moving, followed a few steps of it and started again. Now your trail is kept (where you walked,
  block by block) and a man who's fallen behind runs along it, at a sprint. 150 blocks over hills: 14 blocks behind you
  on average (was 31), all back with you 2 s after you stop (was 8.5).
- **Marches over hills.** On rough ground a marching man is carried from the start (Minecraft's own walking stalls there
  every few steps); the next leg of a long march is worked out while they're still on this one, so nobody stands at the
  end of the route waiting; on contact, men strung out behind close up to the front instead of freezing where they are.
  Taking a hilltop over real land: twice as many men up there in the same time as v9.25.
- **Snowy slopes and dead-end steps.** A snow layer under a man now holds him up (on a snowy mountain every step looked
  like thin air: men stood still 30-40 s). A step that goes nowhere counts as blocked instead of progress, and a man
  blocked at the same spot again and again tries his own walking, then scrambles on to the next free spot.
- **Battle learning works, and now you can see it.** Tested: with it switched on, each faction's habits shift fight by
  fight (e.g. more assaulting after winning that way). When you save the settings with learning on, the chat says what
  each faction has learned so far ("12 fights learned from: more taking cover, less pushing forward..."). Fixed: an enemy
  who just walked out of the loaded land counted as a kill, and a squad that left counted as wiped out.

## v9.25.0 (They march over real land, and they fight back)

Everything here was found by testing on a real generated world (hills, forests, swamps, lakes) instead of the flat
test floors: a 10-man squad marched 210 blocks into a 6-man ambush.

- **They fight back.** Before, the squad fired 6 shots in 80 s while the ambush shot them down: a man held fire
  unless his target was in the clear on all four edges of his aim, which through trees, over a crest or past a fence
  post is almost never, and nothing moved him to a better spot. Now a man half behind cover is a target (fewer hits),
  and a man whose shots keep being refused goes and finds a clear line, or closes in. Same ambush now: the squad fires
  back 130-200 rounds, wipes the ambush out and carries on with 7-9 of its 10 men.
- **They march properly over rough ground.** Before, the squad stood still 80% of the time:
  - Minecraft's own walking stalls on slopes, grass and flowers: a man who hasn't moved for a second on rough ground
    is now carried past the spot.
  - In the open nobody queues any more: each man keeps his own lane beside the route, so the squad moves as a body of
    men, not single file on one line that jammed at every step up a slope (single file only at stairs, doors,
    ladders and drops).
  - The squad no longer waits for men stuck behind it (they're dealt with by the stuck-handling): three men snagged
    on one spot used to hold everyone else standing beside them.
  - Vines hanging to the ground (swamps, jungles) are walked through, not climbed: a whole squad queued at a swamp's
    edge to "climb the ladder" one man at a time.
  - A 210-block march over hills now takes about 1.5 minutes instead of stalling for minutes.
- **Bodies don't fly into the sky.** Men killed bunched on one spot left bodies that climbed over each other every
  tick, a tower of bodies up to 10 blocks high. Bodies now land on what's under them and slide off a heap, never
  rise higher than the blow could throw them, and a man who dies inside a wall is laid out beside it.

## v9.24.0 (Battle reports, far-off vehicles, men who hold their ground)

- Battle report: when a fight near you goes quiet for 15 s, the chat tells you how it went: who held the field (or had
  the better of it), what each side lost (killed, wounded, surrendered, out of how many), who landed the most hits and
  the longest hit of the fight. Skirmishes pass without one. War Table -> Settings has a switch to turn it off.
- Your shots count, and now you see it: when your shot or blow drops a soldier or kills him, the action bar says who
  and how far ("Pvt. Bryant killed · 31 blocks").
- Far sight for vehicles: tanks, trucks, gunboats, boats, planes and helicopters past 62 blocks are drawn out to 250,
  like the soldiers. Each is drawn from its own model, seen from the side you're looking at it from (front, back, side
  or three-quarter), and glides with it, aircraft included.
- Men holding a position stand longer. In an Attack / Defend mission the defenders used to break and raise a white
  flag 16 s in. Squads holding ground (a post, a hold, a sentry line, at their spot) now only break once two-thirds
  of them are gone and they're clearly losing, and raise a white flag only with two men left, four to one against
  them, badly hurt and after at least half a minute of fighting. Each man breaks half as often on his own. The same
  mission now lasts 30-50 s, and the defenders sometimes win it. A squad caught on the march breaks as before.
- Battle pace and you: at Normal pace soldiers' hits on players are toned down only half as much as their hits on
  each other, so the enemy stays a threat to you.

## v9.23.0 (Battles that last, and fights that are fair)

- Battles were over in seconds, and an even-looking fight was a coin flip. Measured: two squads of 12 meeting in the
  open were decided in ~16 s with half of all rounds hitting at 25 blocks, and a force of 16 beat one of 10 only half
  the time (whoever fired first won).
  - A round the dice called a miss now really misses (it used to pass so close it often went through the man's head
    anyway: at range half of all hits were "misses").
  - New: War Table -> Settings -> Realism -> Battle pace. Normal (the new default) is about 40% as deadly as before,
    stray rounds into a crowd included. Firefights now last: a 12 v 12 meeting ~30 s, a shootout at 60 blocks a
    minute or two (real server: 73-176 s), an assault on men behind a wall ~1.5 min. Cover and numbers decide them:
    16 against 10 won 8 times in 8, defenders behind a wall 8 in 8. Fast is the old pace; Slow is longer still.
    The Arcade preset sets Fast, Realistic and Cinematic set Normal.
- Fair fights:
  - Two men who saw each other in the same moment: the one earlier in the game's list always fired first, so in an
    even fight the army spawned first won 7 battles in 8. The turn order now changes every time.
  - Soldiers far from every player look and think less often (to save work). With you standing behind one army, the
    other counted as "far" and lost an even fight 8 times in 8. A man in a fight now counts as far only at twice the
    distance; with you behind one side the even fight went 4-6 and 3-7.

## v9.22.0 (Smoother, and three bugs gone)

Fixes:
- A wounded soldier could stay invisible and unarmed for good: if his body was removed while it was still falling
  (Cleanup / repair -> Remove dead bodies, or a blast that throws a body), he was never put back down. He now is, and a
  falling body is never counted among the dead bodies the cap clears.
- Raised shields stop a player's bow arrows and tridents again (since v9.21.3 they were treated like gun rounds and went
  through). Gun rounds still go through.
- The stair search could hand a small search's answer to a big one (defenders and attackers looked for staircases in
  the wrong places in big halls).

Smoother (measured on a real server, 30 v 30, released vs new, twice each):
- About 12% less script time a tick (34-37 ms -> 29-33 ms), the server held 19.3-19.6 ticks a second instead of
  18.6-18.8, and the worst pauses were ~17% shorter.
- Where a soldier is, which dimension, whether he's still there: the add-on asked the game this thousands of times a
  tick. Each answer is now remembered for the rest of the tick (forgotten the moment he's moved or removed, and fresh in
  every game event).
- A straight walk asks one remembered answer per block instead of five separate lookups; block lookups are quicker.
- "Can I walk there" and short-hop routes could freeze the game for up to 80 ms on new ground. They now share a time
  allowance (25 ms each, 40 ms a tick); the rare one that runs out goes to the route planner instead.
- The stair search finds the steps first: the same answers from a fifth of the lookups (it was a hitch in big halls).
- Looking around: who could be an enemy is worked out once per half second per side, not on every look.

Checked: the simulator's 10 acceptance checks on several seeds; 61 real-server scenarios with no script errors, compared
one by one with v9.21.9, and the ones that differed repeated on both versions (sword duels, ragdolls, sieges, prisoners
following round walls, wounded crawling to cover): all within the game's normal run-to-run spread.

## v9.21.9 (Lighter on your device)

- The add-on now keeps to a time budget of its own each tick (Performance: Low 8 ms, Medium 14, High 22). On a phone
  or console the game and the screen share one processor, so its time came out of your frame rate long before the
  old safeguard (which waited for the server itself to fall behind) did anything. Over budget, soldiers look and think
  a little less often (at most 1.5x), and go back to normal as soon as there's room.
- Gunners between shots or reloading no longer re-check everything every other tick.
- Measured in a 30 v 30 on a test server: about 10% less script time a tick, shorter worst pauses.

## v9.21.8 (They move like players)

- In a fight, soldiers used to dash and charge slower than you walk. Now a dash, a charge, a flank or a run to cover goes
  at a player's pace (your walk to your sprint), and an ordinary move is a brisk walk, each man at his own pace.
- Indoors, on stairs and through doors (where the add-on carries them) they move at your walking pace too (was 3.4
  blocks/s, now 4.2), so defenders still reach the ground floor before the faster attackers break in.
- Squads arrive about 30% sooner on long marches.

## v9.21.7 (Clear the bodies)

- War Table -> Cleanup / repair -> "Remove dead bodies": every body in loaded land is gone at once. Nothing else is
  touched (living soldiers, vehicles, flags and markers stay).

## v9.21.6 (Far sight: see them as far as a sniper does)

- Bedrock stops drawing mobs about 64 blocks from you. It's a fixed limit: no setting raises it (Simulation Distance
  doesn't, as v9.21.5 wrongly said) and no add-on can. Particles are drawn at any distance, so past 62 blocks, out to
  250 (a sniper's sight), every soldier is now drawn for you as a small picture of himself: his own uniform (cut from
  his own skin, medics and custom skins included), facing you, lit by the light where he stands, moving with him,
  kneeling or lying as he does. Walls, hills and fog hide him the same as up close. Crews inside vehicles aren't drawn.
- With that, v9.21.5's rule is gone: soldiers fire from their full range again, because you can see them there.

## v9.21.5 (They can't shoot you from where you can't see them)

- Bedrock draws a mob for you only inside the world's Simulation Distance (world settings), whatever your render
  distance, and an add-on can't change that. A sniper sees 250 blocks, so he could hit you from well past where the
  game draws him. Soldiers now shoot at a player only from where the game is drawing them: always within 56 blocks,
  and farther only while the game is simulating them (checked with a nudge you can't see). They still watch and spot
  from their full range.
- To see soldiers farther away, and fight them there, raise Simulation Distance (12 chunks is about 190 blocks) and
  keep Render Distance at least that high.

## v9.21.4 (Ammo never runs out)

- Soldiers no longer run out of ammo: the "Limited ammo" setting is gone (and from the Realistic / Cinematic
  presets). Every magazine still has to be reloaded, with the same reload time as before.

## v9.21.3 (Your shots count; back in the fight)

- Your gun's shots went through nothing on a soldier with his shield raised toward you: only the soldiers' own rounds
  were recognised as bullets, so every round you fired into a shield was blocked outright. Any hit from a player that
  isn't a punch or a sword blow (or made with a gun in hand) is now a bullet: a raised shield takes only the edge off
  it, a lowered one nothing. Swords on a raised shield are still stopped.
- A man who surrendered picks his gun back up and fights again, and a prisoner is set free (guard or not), when his
  own side is all round him: 3 or more of them on their feet within 8 blocks, and more of them than of the enemy.
  Tested: with 2 of his own, or 3 against 4 of the enemy, he stays as he is.

## v9.21.2 (Prisoners change hands)

When the soldier guarding a prisoner is killed (or goes down, is captured or surrenders), the prisoner is taken over
instead of standing alone:
- by the next closest man of the same group (squad), and again by the next each time one falls;
- with the whole group gone, by the closest man of the same side;
- with none of them left, by the closest soldier of another side at war with the prisoner: he's their prisoner now,
  follows them and is taken to their lines.
- A prisoner left alone with nobody of his captors' side near is picked up by any side at war with him that comes
  within 16 blocks. His own side (as before) frees him.
Tested on a real server: captor killed -> next of the group -> next of the group -> a third side at war with him ->
left alone -> picked up by a passing enemy, unharmed throughout.

## v9.21.1 (Bodies never stay forever)

Bodies from an earlier load could stay for good. Only bodies in loaded ground were cleared when the world started, and
a body whose ground was unloaded (you walked away from the fight) was forgotten and never cleared after that. Now
every body carries the load it was made in and when it fell:
- A body from an earlier load (or from a version before this one) is cleared as soon as its ground is loaded again,
  or by a sweep every 30 seconds.
- Any body older than 10 minutes goes, wherever it is: one you're looking at sinks into the ground instead of
  vanishing (before, a body in view was never taken away, so one you kept looking at could stay forever).
- A body that was unloaded and loaded again is counted again, so the limit on how many lie about (16 / 32 / 48 by the
  Performance setting) still applies to it.

## v9.21 (No more hesitating)

Every kind of NPC was put through a new audit on a real server: how often a man stands still while he's meant to be
going somewhere, walks back and forth without getting anywhere, flicks his head, or changes his mind. Each cause found
was fixed and measured again.

Prisoners and following
- Prisoners keep about 2.5 blocks behind whoever took them: you, if you did, or the soldier who did (if he falls, the
  nearest man of his side takes charge). A soldier's prisoner goes along with him and is left under guard once they're
  back at their side's lines. Measured: 2.7 blocks behind a walking captor, player or soldier.
- "Follow me" squads keep up at your walking pace (they caught up slower than you walk, so once behind they stayed
  behind), set off at once when you sprint away, and go round walls and buildings by a real route instead of pressing
  into them. Measured: back in formation 4 s after an 18-block dash (was 6.5 s); round a 40-block wall in 11-14 s
  (before: never).

Walking
- The biggest one: Minecraft only walks a man the way his body faces. The gun kept turning soldiers toward anyone off
  to the side while they walked: at 45 degrees off his path a man made a fifth of his pace, at 90 he stood still. On
  the move, a soldier now aims and fires only within 40 degrees of his way; wider shots wait till he stops.
- Sent somewhere new, the game took anywhere from 0.2 to 3 seconds to set a man off (measured), every time. He's now
  turned and walked the first steps at once.
- A man counted on a route point on the far side of a wall cut the corner into it and stood there. Fixed, and the
  straight-walk check no longer cuts the corner of a wall on a diagonal.
- Blocks you place, break or blow up, pistons and doors are noticed at once (what the soldiers knew about the ground
  was kept for up to a minute).
- While a new route is worked out a man keeps on the way he was going, instead of stopping for it.
- Moves to an exact spot (cover, a firing position, the machine gunner's flank) finish there instead of three blocks
  short.

Riders, crews, medics, patrols
- Cavalry: the rider's head snapped between his horse's line and his target ten times a second, and the gallop pulsed
  fast-slow. One look per tick now, and the horse is held at its pace: head flicks 320 a minute -> about 6.
- Soldiers in a truck, boat, gunboat or helicopter seat: the same nodding head fixed (68 flicks a minute -> 0); they
  still shoot (a truck's crew killed all three enemies in the test).
- Medics go right to the wounded man's side (they stood 2.8 blocks off forever, "going to a downed soldier").
- Patrols keep to the radius you gave them ("free to use judgment" made it the whole 100-block area) and walk their
  rounds without stopping at every point (stalls 31% -> about 12%). Only marches and wide patrols send a scout out,
  and he no longer stops every 5 s on his way back.
- The machine gunner's move to the squad's flank is kept until he gets there (it was dropped half a second after he
  set off, eight times a fight); the flank point no longer shifts every 10 s.
- A squad holding a house keeps its spare men inside it, covering the rooms, instead of sending them out of the door.
- The watch reaches its posts (men stood 5 blocks out "going on watch"); a man out of ammo takes a dead man's rounds
  reliably; a march's scout turns back as soon as he's gone as far as he can, instead of standing out there for 25 s.
- Escort mission: a message if the VIP can't be placed where you stand (it silently did nothing).

Measured with the battle simulator against v9.20.2: 10/10 acceptance checks; storming a building, the attackers
reach the upper floor in 3 of 4 runs (was 0 of 4) on less than half the script work; castle defenders stay on their
walls as before; marches and stairs unchanged.

## v9.20.2 (See out of your vehicles)

The seats sat inside solid parts of the vehicle models (the truck cab, the gunboat cabin, the helicopter nose), and
the troop boat's sail stood right at eye height in front of everyone. Reshaped so you can see ahead and look round:
- Transport Truck: an open cab (low hood and dashboard, slim pillars, a high roof, no solid windscreen); the men in
  the back see over the cab, and the bed has canvas hoops instead of a closed canvas.
- Coast Guard Gunboat: an open wheelhouse (waist-high walls, pillars, a higher roof); the bow gun's shield is low.
- Helicopter: an open-frame cockpit, waist-high cabin walls with door pillars, a higher roof.
- Troop Boat: the sail is up above head height, and the driver's seat is now at the front.
- Plane: the wing no longer passes through the passengers' eye line.
- Tank: the second player sits up top by the hatch instead of behind the gun barrel.

Measured from each driver's eye (a fan of sight lines 60 degrees left and right, level to 30 degrees up, 4 blocks out):
the part of the view the vehicle itself blocks went from 44-97% to 10-22% for the truck, gunboat and helicopter drivers
and from 48% to 12% on the troop boat (what's left is mostly thin pillars and the roof when you look up).

## v9.20.1 (Boats and trucks follow you)

- "Mount up" from the Command Baton now also sets the men to follow you: in vanilla boats the man at the front rows
  after you; on horses they ride after you.
- "Board the vehicle I'm looking at": the men aboard follow you too. If you don't take the wheel yourself, the
  soldier in the driver's seat drives the Troop Boat, Coast Guard Gunboat or Transport Truck after you, slows as he
  closes in and stops a few blocks off. A truck takes one-block steps; a boat only goes where there's water.
  (Tested: a truck closed from 46 to 7 blocks, a troop boat from 54 to 6, everyone still aboard.)
- Soldiers on another order (Charge to a spot) drive there instead.

## v9.20 (Steadier minds, faction people, missions, battle sounds)

Every item below was tested on a real server unless marked otherwise.

### Soldiers stop second-guessing themselves (top priority)
Measured in a 6 v 6 firefight and on a march, before -> after:
- Changes of plan per man per minute: 19 -> 5. Flip-flopping (doing A, then B, then A again within 3 seconds):
  3.2 a minute -> none. Switching targets: 10 a minute -> about 1.
- Big head swings (12 degrees one way and back within half a second): on the march 12.7 a minute -> 0; in a
  firefight 7.2 -> 0.3; in a sword fight 16 -> 4.

What was wrong:
- Gun soldiers still carried the game's own "ranged attack" behaviour. It fired invisible blanks, took over
  their legs whenever it saw an enemy and turned them toward its own choice of target, fighting the mod's aim.
  It's gone (crossbowmen keep it: their bolts are the game's own).
- The brain re-decided every half second with no preference for what it was already doing. Now a man sticks to
  his plan unless something is clearly better.
- When the man he was shooting ducked, his gun swung onto someone else and straight back. Now he keeps his sights
  there for two seconds.
- Two parts of the code turned him toward different enemies; now one does.
- Marching side by side, each man's place in the line swung from side to side on grid-shaped routes, and the
  game snapped bodies up to 30 degrees a tick toward each grid step. Both fixed.
- In a sword fight, the swing faces him now (two things were turning him).
- Men turned to whoever was talking even mid-fight; now only off duty.

### Faction people
- War Table > Settings > Faction people: each faction has a primary language and skin, and optionally a second
  and third group of men with their own language, skin and share. A man's voice, name and skin all come from his
  group. Example: a US army in US English, with 30% AAVE wearing the new American Infantry (Black) skin.
- New skin slot 18: American Infantry (Black).

### Command
- Order form: Formation (auto, line, column, wedge), kept on the march.
- "Follow me" squads walk behind you in that formation, turned the way you walk (each man within about half a
  block of his place in tests).
- New orders: "Set a rally flag where I'm looking" and "Return to base".
- New flag type: Headquarters. "Return to base" marches there, men heal there, and a reinforcement point can send
  its waves from the HQ.
- Squads at rest keep men on watch (a quarter by day, a third at night) at posts facing out, changing every two
  minutes.

### Missions (War Table > Missions)
- Attack / Defend: one side holds where you look, the other comes for it, against a timer.
- Wave survival: waves, bigger each time, come for you from all sides until you fall.
- Escort: get a VIP across the map past ambushes.

### Sights and sounds
- Gun smoke puffs and ejected brass casings (with a tinkle) near the player.
- The crack of a round passing close to your head.
- A distant rumble when a fight is going on out of sight, from its direction.
- Dust from running men; a hit tick when your shot lands; men hunch over in the rain.
- A blood trail where the wounded are dragged; bloody stumps where a limb came off (drawn on your screen: not
  testable on the server).
- Bodies falling against a wall slump down it instead of bouncing off.
- Rounds now really go through full glass, wood and leaf blocks (only panes worked before); stone stops them.

### Tools and upkeep
- War Engine Guide item: what everything does, in chapters.
- Settings > Export / import settings: one code with all your settings, faction people and formations.
- Settings > Recent problems: the last script errors, for bug reports.
- Each soldier's identity is now one saved record (older soldiers are moved over automatically).
- The build refuses to pack a broken JSON file or script; a check runs on every push.
- Fewer game calls in big battles (about 505 -> 440 a tick in a 90 v 90).

## v9.19 (Signal flag, real names, quieter camps, prisoners spared)

Every item below was tested on a real server.

### Fixes you reported
- **Prisoners are no longer killed.** Taking a prisoner used to give him back his "enemy" status, so the men around
  cut him down. A prisoner or a man with his hands up is now nobody's target: squads forget him as an enemy and a
  soldier's or hound's blow on him does nothing. (Test: 3 prisoners taken in the middle of a fight, all 3 alive.)
- **Names follow the faction's language.** A faction set to Greek ("Petropolis") gets Greek names and ranks, e.g.
  "Stratiotis Grigoris Petropoulos". Names change as soon as you save the language.
- **Reinforcements wear your skin.** A wave wears the skin most of that faction's men wear (one you gave with the
  Unit Wand), or one you pick in the new Skin option when you set the point up.
- **No more whole squads lying down.** At night at most a third of a squad sleeps, beds first, never out in the rain,
  spread out at different angles, rifles put away and taken back on waking. Anything happening wakes them.
- **Bodies stay.** Bodies were being removed after a minute even while you watched. Now a body is never taken away
  while a player can see it; out of sight the oldest go first, and only if there are far too many in view do the
  oldest sink slowly into the ground. The dying man disappears the same instant his body appears (no double).
- **Hand signals without a menu.** The new **Signal Flag** item: hold it, sneak and scroll to pick a signal (suppress,
  attack, take cover, fall back, hold fire, open fire, follow me, regroup on me, spread out), use it to give it.

### Names
- 90-210 surnames and 35-70 first names per language (Korean, Chinese and Maya have fewer because those cultures
  have fewer surnames). Ranks always in the faction's own language.
- The unit card (crouch and look at a soldier) shows his first name too: "Pvt. Miguel Garcia".
- No two men in the same squad share a surname.
- Earned nicknames: "Doc" (three rescues), "Lucky" (back up three times), "Deadeye", "Hawkeye", "Buzzsaw", "Mad Dog"...
- New callout language **American (US English + AAVE, mixed)**: each man is one or the other for good, his voice and
  his name together. (Ready for a future skin for Black soldiers of American divisions.)
- Setting (Callouts > How often they talk / subtitles / names): Mixed heritage names, about 1 man in 7 with a surname
  from another culture.

### New items and blocks
- **First Aid Kit**: use it on a soldier to patch him up or get a downed man back on his feet; with nobody there, on yourself.
- **Barbed Wire**: slows and scratches whoever walks into it; soldiers route round it.
- **Ammo Crate**: soldiers refill next to it, and a man out of ammo walks over to one.

### Soldiers' life
- Off duty, near a player: men check their rifles, stretch, read a map, eat (smoking: Settings), or two of them face
  each other and talk. Men turn to look at whoever is talking.
- Sentries walk a short beat along their post.
- At night with the enemy about, callouts are said quietly.

### In the fight
- A wounded man is dragged a short way under fire, carried over the shoulder for longer distances.
- Medics and first-aiders kneel while they treat. Enemies bandage and take more wounded prisoners.
- Men out of ammo take rounds off the dead.
- An explosion nearby: men flinch, slow down and are slower to fire for a few seconds.
- More smoke when a squad pulls back or breaks.
- After a fight the sergeant gives a head count on the radio and stragglers close up on him.
- MG gunners take a moment to set up after moving. Kneeling steadies the aim, running spoils it. Long MG and SMG
  bursts climb.
- Rounds go through glass, leaves, wool and thin wood (weaker), and stop on stone, brick and metal, with sparks.
- Helmets sometimes turn a round aside ("ping"); armour that takes many hits loses its helmet.
- Swordsmen and spearmen parry, sometimes with an instant riposte. A shield bash breaks the other man's guard.
- Spearmen facing a charging horse stop it dead and may unseat the rider. A rider at the gallop hits harder. A
  horse that's hit shies and stops.
- The unit card shows how suppressed a man is.

### Performance
- Glances and the off-duty animations are skipped on the Low performance setting and when no player is near.
- A per-soldier check that read saved data every few ticks now does the cheap checks first.
- A 90 v 90 battle in the test simulator stays under its 500-calls-a-tick budget (about 480).

## v9.18 (Soldiers with names, nerves and a war around them)

Every item below was tested on a real server; the numbers are from those tests.

### Who they are
- **Names and ranks in their own language.** Each soldier has a surname and a rank that follow his faction's callout
  language (War Table > Settings > Callout language): American, AAVE, British, German, Russian, Korean, Greek,
  Mongolian, Dutch, Hebrew (Jewish), Igbo, Haitian Creole, Spanish (Dominican), plus Italian, Hindi, Syrian Arabic,
  Chinese and Yucatec Maya. Change the language and every name changes with it ("Schuetze Becker", "Ibyeong Kim",
  "Solda Francois"). The name shows above his head and on spoken lines.
- **Veterancy.** Kills, putting enemies down, rescues and surviving fights give experience. Men are promoted (private,
  senior private, corporal, sergeant; a veteran squad leader is a lieutenant), wear 1-3 stripes on the arm, aim
  steadier and keep their nerve longer.
- **Temperaments.** Brave (first to hold, last to break), Cautious (pulls back sooner, spots traps more), Steady, and
  the rare Hothead. Now and then a hothead fires too early in an ambush or charges alone against orders (at most once
  every few minutes across the whole map, so it's an event, not a habit).
- **Buddies.** Men are paired in each squad. A man's buddy comes for him first when he's hit, and they bound together
  as a fire team. When a buddy is killed, the other either goes after the man who did it (a grudge: he picks that man
  out) or is badly shaken for a while.
- **Medals.** After a fight: Valor (3+ enemies), Lifesaver (got a wounded man back up or out of the fire), Wound (went
  down and lived). Shown as ribbons on the chest; announced on the radio.
- **Unit card.** Crouch and look at a soldier: name, rank, type, weapon, health, temperament, experience, his buddy,
  his medals and what he's doing.

### Men who feel it
- **Hit reactions.** A flinch on every hit and a step back from the blow; a leg hit staggers him and he limps for about
  30 seconds; an arm hit spoils his aim for a while.
- **Pinned down.** Under heavy fire a man crouches with his head down behind cover and only fires blind (badly).
- **Panic and rally.** A squad that's lost half its men and is still losing can break: the green men run. Their
  sergeant (who holds) or the steadiest veteran rallies them back. Veterans and brave men don't break.
- **The wounded.** Badly hurt men limp; a man going down calls the squad medic by name on the radio.
- **Surrender.** Hands up and on his knees. A squad that's down to a few hurt men facing three times their number
  raises a white flag together.
- **Grenades.** A man with a live grenade at his feet sometimes throws it straight back (veterans and the brave more
  often). Veterans cook their grenades first, so theirs can't be thrown back.

### Tactics
- **Ammo.** Every gunner carries a limited number of rounds. In a long fight they run low: a squad mate with the same
  gun shares his, a friendly truck or flag refills them, and so does a quiet spell. Out completely, he fixes his
  bayonet. (Settings: "Limited ammo", on by default. The sidearm pistol is unlimited.)
- **Fire teams.** Bounding (one team moves while the other covers) now uses fixed teams: each man with his buddy.
- **Snipers** move after a few shots or when shot at, to a new spot that still sees the enemy, and pick off squad
  leaders first.
- **Clearing buildings.** Attackers call "Clear!" room by room, and one man stays at the foot of the stairs watching
  up them until the squad goes up.
- **Rearguard.** When men fall back with the enemy in sight, one or two of the steadiest stay a few seconds to cover
  them, then go.
- **Formations by the ground.** A column on a road or through a narrow way, a line when the enemy is about, a wedge
  across open ground (on the march's start, front and arrival).
- **Scouts.** A squad on the move sends a man about 30 blocks ahead. He doesn't start fights; when he sees the enemy
  he comes back, and only when he's back does the squad know: kill him and they march in blind.
- **Traps.** Defenders settled in a building with no fight yet string a tripwire with a charge inside a door. The
  blast never breaks blocks; the string is taken away after ~5 minutes. Attackers can spot and cut it (veterans and
  cautious men more often).
- **Feints.** When part of a squad flanks, two men move the other way and make a lot of noise.
- **Counterattacks.** Defenders who throw back an attack (the attackers running or few left) chase them for a short
  while, then return.
- Routes in a fight already keep out of the enemy's sight where they can (unchanged).

### The world and the command
- **Night in camp.** Off duty at night, men sleep where they stand while a third keep watch, in turns. Any sign of
  the enemy, a shot nearby, a hit or an order and they're up.
- **Weather.** Rain cuts how far soldiers can see (to ~70%), a thunderstorm more (~55%). (Fog can't be detected by
  add-ons.)
- **Bodies cleared gracefully.** At most ~32 bodies (by the Performance setting); the oldest are removed where no
  player is looking, or sink slowly into the ground if every one is in sight. Bodies older than 10 minutes go too.
- **Desertion.** Rare: at night, a beaten man with nothing left (hurt, lost his buddy, out of ammo, squad half gone)
  may slip away from his squad and is gone, unseen.
- **Hand signals.** Command Baton > first page > Hand signals: to your soldiers within 48 blocks: suppress the enemy
  you're looking at, attack where you're looking, take cover, fall back, hold fire, open fire.
- **Undo my last order** (Command Baton, first page): everyone it went to goes back to what they were doing and where.
- **Reinforcement waves** (War Table > Reinforcements): a point that sends a squad of 2-20 every 1-10 minutes, for a
  number of waves or until removed, marching on a spot you pick, on the nearest enemy, or holding.

### Scale and settings
- **Performance** (Settings > Performance): Low / Medium / High: how many bodies fall with full physics at once and
  how much time they get, how many bodies are kept, how close a soldier must be to a player for full attention.
- **Huge battles.** Over 200 soldiers, the far ones (out of every player's sight) think and look about half as often,
  and their bodies are laid down without physics. 300 soldiers fighting ran slightly faster than v9.17 did, with all of
  the above added.
- **Save / load battles** (War Table): every soldier within 200 blocks (name, rank, temperament, kit, medals, health,
  job and place) into one of five slots; load it back later, with or without clearing the area first.
- **Quick presets** (Settings): Realistic, Arcade, Cinematic: a group of settings at once.

## v9.17 (Guns that work, mounts that face forward, smoother bodies)

- **Bullets work again against swordsmen.** Since v9.15 a raised shield stopped 80% of a round, and swordsmen raise
  it whenever they're under fire, so they took about 3× the rounds anyone else did (9 hits to drop instead of 3).
  - A wooden shield doesn't stop a rifle bullet: raised, it now only takes the edge off a round (20%); lowered,
    nothing.
  - Against blades, arrows and crossbow bolts it still blocks as before.
  - Now an unarmoured swordsman drops in 3-4 hits, the same as everyone else.
- **Mounts face where they're going.**
  - The game turns a ridden horse to face wherever its rider faces, so a cavalryman aiming off to the side swung
    his horse sideways every other tick. The script also slid mounts toward their target instead of steering.
  - Now every mount (horse, donkey, camel, any saddled animal) turns at an animal's pace and is only ever moved
    along its own heading, slowing down in sharp turns.
  - The rider sits square in the saddle and fires at anything up to ~100° off his line.
  - Measured: horses were more than 30° off their direction of travel 41% of the time when moving; now 0%
    (0.7° average).
- **Bodies fall smoothly.** The physics already dropped a man in 2-5 ticks, but his pose only reached your screen
  every 3rd tick, so the fall looked jerky. While he goes down it's now sent every tick; positions aren't re-sent
  when the body hasn't moved, so it costs no more.
- A rider killed in the saddle is thrown off at once and lies where he fell (no bouncing on the horse).

## v9.16 (Moving like people)

Measured on a real server, before and after:

- **No more staring at the sky or the ground.**
  - Standing soldiers kept tipping their heads 40-70° down about once a second. The game's own walking kept re-aiming
    at the marker at their feet, and the gun pack's arm animations follow the head, so guns pointed at the ground or
    the sky and bodies leaned. A soldier at his post now simply stands.
  - The game's random "look around" (which also looked straight up) is gone.
  - Every scripted move (route walking, the guard detail) turns the body only, never tipping the head.
  - A safety check levels any head still tilted with nobody to aim at.
  - Result: head tilt idle, in a firefight and on a guard detail went from up to 90° to 0.
- **No more second-guessing in a fight.** Gunners re-picked their target from scratch every look, so every gun swung
  between enemies about twice a second.
  - Now a man sticks with the enemy he's on.
  - He changes target when that man drops or disappears, when someone gets right on top of him, or when he's shot at
    from elsewhere.
  - Target changes went from ~25 per 15 s to 0-1.
- **A human idle look.** Soldiers with nothing to do now and then glance along their sector at a human pace and look
  back, and a player who walks up close gets a look.
- **Turning at a human pace** everywhere a script turns a man (routes, the guard detail), instead of snapping.
- **Shield wall holds its ground.** The line is set off the squad's hold position, not the men's own positions. Before,
  every step up to the line moved the line forward until the wall walked into the enemy.
- Performance: the 90 v 90 test stays within its budget (474-488 game calls a tick).

## v9.15.1 (A real protective detail)

- **Guards stay on you.** Before, an escort walked like any follower: the game's own walking stops about 3 blocks
  short and only re-aims every second or so, so they trailed behind in a loose bunch. Now each guard has an exact slot
  in a tight diamond (point man ~2 blocks ahead, flanks ~1.7 to each side, one behind), and a driver keeps him on it
  every tick at your pace, a touch faster to close up.
  - The diamond turns with the way you're walking, not where you look, so glancing around doesn't send them circling.
  - It leads slightly where you're heading, steps up and down blocks with you, never cuts through you or walks off a
    drop, and draws in tighter indoors.
  - Standing still, each guard faces outward, watching his sector.
  - Tested walking, sprinting and turning: every guard within ~0.5 blocks of his slot (0.7 sprinting), the farthest
    3.6 blocks from you (the point man); a 90° turn re-forms in ~2 s.
  - Threats: the nearest guard steps in 1.3 blocks from you on the threat's side, the rest form an arc and fire; hit,
    they close to ~1.2 blocks.

## v9.15 (Shields, bodyguards, officers, night battles, looks after itself)

- **Shields.** Swordsmen, spearmen and crossbowmen now carry a shield in the off hand (Settings: "Shields for
  swordsmen, spearmen and crossbowmen", on by default; gunners don't get one).
  - A raised shield stops blades, bolts and arrows from the front outright, and most of a bullet's force. Hits from
    the side or behind get through. A lowered shield still catches some.
  - Swordsmen and spearmen raise it and walk slower while closing in under fire.
  - Crossbowmen under fire duck behind it between shots, and raise it against a man right on top of them.
  - **Shield bash:** someone pressing close in front of a swordsman gets shoved back, stunned and hurt a little.
  - **Shield wall:** three or more shields in a squad holding ground against shooters lock into a line facing them,
    with the squad's crossbows a step behind. The line stays put instead of shuffling.
- **Guards are a protective detail** (Guards on "Escort me"):
  - a diamond around you, turned to where you look, with a point man ahead; it draws in tighter indoors;
  - when a threat shows up, the nearest guard steps between you and it, the rest spread on that side and return fire
    ("Contact! Cover the principal!");
  - when you're hit, they close in around you ("Shots fired! Cover! Cover!");
  - they never chase off after whoever shot at them. Sword guards only fight a threat that gets close to you.
- **Officer insignia.** The man running each squad (the sergeant, the one who takes command when a leader falls) wears
  gold shoulder boards and a badge. When he goes down it moves to whoever takes over. It follows the armband setting.
- **Night battles.**
  - At night, gunfire shows a bright muzzle flash you can see across the field.
  - Squads in a firefight now and then send up an illumination flare over the enemy. It climbs, pops, and drifts down
    for about 20 s, really lighting the ground under it.
  - The light is taken away as the flare moves and when it burns out, including if the world was closed mid-flare.
  - Settings: "Night battles: muzzle flashes and illumination flares".
- **Riderless horses.** A cavalier who loses his horse walks back to it (or to a free saddled horse of his side
  nearby) and gets back on, instead of popping onto it from a distance. Tested: back in the saddle from 20 blocks
  away in ~12 s.
- **Looks after itself:**
  - stale marker reservations are freed every 5 minutes on their own;
  - war horses whose rider is dead or gone are taken away after 5 minutes alone;
  - the soldiers' saved-data churn during marches is roughly halved (an order's parked goal and retreat timer are
    saved in the batched record; waypoint birth times are kept in memory only).
- **MG nests removed.** The item is gone, and any nests already in a world let their gunner off (he takes his own gun
  back) and disappear. The gunboat's and helicopter's MG seats still work as before.

## v9.14.1 (Horses, for real this time)

- **Cavaliers ride their horses.** Reproduced the failure exactly. In game versions without the "spawn tamed adult"
  event, the horse came out with none of its usual make-up (not grown, no seat, not tameable), got saddled, and stayed
  wild, so every rider was thrown or never got on. Now a mount spawned that way is given its grown-up make-up, tamed
  FIRST (with the game's own "on tame" event if the taming call can't), and only then saddled. Horses already stuck
  wild and saddled in your world are put right the next time their rider tries them. Tested on a real server in that
  exact situation: 3 of 3 riders up and staying up.
- **Mount list.** A Cavalier's own mount (egg, Unit Wand, group edit) is one of horse, donkey, mule, camel, African or
  Asian elephant, at every content level (Vanilla: the vanilla ones). Anything else saddleable can still be ridden the
  manual way, as before: saddle it and give "Mount up".

## v9.14 (Horses that work, content levels, better ragdolls, prisoners, cavalry that find their way)

- **Riders get on their horses.** In some game versions the "spawn tamed" event is missing, so the horse came out
  wild and threw its rider off at once. Mounts are now tamed with the game's own taming call and saddled through
  their saddle slot, which works on every version. Wild saddled horses already in your world are tamed the next time
  a rider tries them.
- **Cavalry find their way.** A mounted man used to ride straight at where he was going and stop at the first wall.
  Now the route planner works out the way (as it does on foot) and the mount follows it:
  - route points are moved off the walls (a horse is wider than a man), and he checks his full width before cutting
    ahead;
  - when he's wedged on a corner he backs off and goes round;
  - riders sent somewhere together ride in a line abreast, keeping pace.
  Test: 4 riders sent round a 36-block wall. Before, all 4 stopped at it; now all 4 got there, 4 runs out of 4.
- **"Markers were full" fixed.** Marches whose soldiers had been removed (not killed), or were far away, kept their
  route markers forever, so over a long session all 1600 filled up. Marches nobody has seen for 30 minutes now let
  go. When markers do run short, what's been held for nothing for 5 minutes is freed and the order goes through at
  once, with no "give the order again". A spot that isn't loaded now says so, instead of blaming the markers.
- **Content level** (War Table > Settings > Content):
  - **Vanilla:** only what the game has: swords, spears, crossbows; vanilla mounts; add-on vehicles are refused and
    the item comes back.
  - **Light:** no MG, sniper or bazooka; mounts limited to horse, donkey, mule, camel and the elephants.
  - **Full:** everything.
  Soldiers already out there switch over by themselves, and get their own weapons back when it's switched up again.
  Egg and Unit Wand menus only offer what the level allows.
- **Ragdolls:**
  - Bodies wear the armor the man wore (leather, iron or netherite), bending with the body, and lost with a torn-off
    limb.
  - A round through a body jolts it and sprays blood.
  - Bodies land on each other instead of passing through.
  - A pool of blood slowly spreads under each body once it's still, and stays as long as the body does.
  - A body draped over an edge no longer twitches for seconds.
- **The wounded fall like the dead.** A man who goes down wounded drops with the same physics as a body, then lies
  where it came to rest and carries on wounded (crawl, rescue, revive). Finished off while falling, that body is
  simply his.
- **Cavalry:**
  - Riders can be wounded: thrown from the saddle, and back on the horse once a medic has seen to them.
  - When the enemy is indoors, or the horse can't get on, the rider dismounts and fights on foot, and remounts when
    it's over.
- **Unit Wand: "Edit everyone nearby".** Change weapon, armor, skin, stance and mount for a whole group within a
  radius (one faction or unit type if you like). Anything left on "Keep" stays as it is.
- **Soldiers take each other prisoner.**
  - A man who surrendered is taken by the nearest enemy soldier and marched to that side's lines (their nearest war
    flag, else the captor's post).
  - Once the fight's over, the winners sometimes take wounded enemies prisoner instead of leaving them.
  - His own side frees him by reaching him with no guard near (a player of his side frees him with a tap), and a
    prisoner left unguarded long enough may slip away.
- **Wounded vs. killed, fixed at the root.** By the time the game tells the add-on about a hit, it has already taken
  the damage off his health. So "is this the blow that drops him?" was judged against health already lowered by that
  same blow: a man on 12 HP hit for 7 went down, and overkill one-shots were far too common. This is behind the old
  "they always go down". His health just before the hit is used now.
- **Lag:** in a 180-man battle, bodies had cost about 15 ms a tick. Now all falling bodies share a 3 ms-a-tick budget,
  the physics does less work, and a body beyond the 10 falling at once is simply laid down where it fell. A body now
  costs about 1 ms to start, down from about 17.

## v9.13 (Cavalry on real mounts, cavalry guns, armor from the egg, armor that counts against bullets)

- **Cavalry ride real mounts.** A Cavalier is now an ordinary soldier on a real, tamed, saddled mount instead of a
  horse-and-rider model.
  - New **Mount** option on the Cavalier egg and in the Unit Wand. Vanilla: horse (default), donkey, mule, camel,
    skeleton horse, zombie horse, pig, strider. World Animals (if installed): African and Asian elephant, mammoth,
    rhinoceros, giraffe, ostrich, lion, white lion, tiger, white tiger, leopard, snow leopard, panther, cougar.
    Without World Animals, those picks give a horse.
  - **Weapons that make sense from the saddle:** sabre, lance, carbine rifle, semi-auto, SMG, shotgun, pistol,
    crossbow. MG and sniper are left out.
  - **Tactics:** gunmen keep 10 to 20 blocks off their target and circle it, shooting from the saddle. Sabres and
    lances charge, strike as they pass (the lance hardest, and harder at speed), ride on, and wheel round for
    another pass.
  - A rider whose mount is killed fights on foot, and takes any free saddled mount nearby. When a rider dies, his
    mount stays. Cavaliers from older worlds are switched over by themselves: the old horse body goes and they're
    given a real horse.
  - Tested on a real server: horse, camel, pig and lion riders all mounted (tamed, saddled), charged or kept their
    distance as they should, and beat 6 men on foot.
- **Armor from the egg.** Every spawn egg has an Armor option (none, leather, iron, netherite), so the Unit Wand
  isn't needed for it.
- **Armor counts against bullets for players.** Rounds that hit a player now hit like any mob's attack: his armor
  counts and the game's short pause between hits holds. A squad's fire used to land every round in the same
  instant, so full netherite melted in about a second. Measured: netherite cuts a round to about a quarter.
  Soldiers in armor were already protected (a man in netherite lasts about three times as long as one in none, 10
  to 11 seconds under a 6-gun squad's fire), so that's unchanged. The Realism menu's damage slider still scales it
  all.

## v9.12 (Ragdolls with knees and elbows, bodies keep their skin)

- **Bodies keep the skin the man wore.** A soldier in his faction's skin stores no skin of his own (it's worked out
  on the fly), so his body fell back to the default uniform. Now the body takes exactly the skin he was drawn with:
  his own, his faction's, or the cavalry uniform. Tested: faction skin 7 and own skin 12 both carried over.
- **Ragdolls bend at the knees and elbows.** Each arm and leg is now two segments, with the skin still mapped
  right:
  - Knees bend forward only, up to about 130 degrees; elbows bend back only, up to about 120. Knees can fall to
    the side.
  - A man shot standing buckles at the knees and goes down in a heap. A running man keeps his momentum and pitches
    forward. Bodies come to rest in about 1 to 1.5 seconds.
- **Lighter.** Joint angles go to the client every other tick and it smooths in between; at most 8 bodies fall at
  once. With 20 men killed in the same instant, the worst tick was 9 to 11 ms.

## v9.11 (Real ragdolls, real dismemberment, the blood pack's blood)

- **Full ragdoll deaths.** A dead man is now a jointed body:
  - Hips, shoulders, head, hands and feet are joined by bones, with gravity, block collisions and friction on the
    ground. Torso, head, both arms and both legs are each on their own joint, driven by the physics every tick.
  - He crumples where he's shot, folds over low cover, falls off ledges and steps, and gets thrown and tumbles in a
    blast. A headshot snaps the head back. A grenade among the dead throws the bodies again.
  - The legs fold no further than a right angle, the neck only nods, and nothing ends up inside a block.
  - Each body simulates only while it moves (about 1 to 3 seconds), then sleeps.
  - Lag test on a real server: 20 men killed in the same instant cost at most 8 ms in the worst tick, against a
    50 ms budget. At most 10 bodies fall at once; any more fall in one go and simply appear where they land.
- **Real dismemberment.** The head, an arm or a leg comes off as its own tumbling piece, and a grenade at a man's
  feet can take two or three. The stump keeps pumping blood for a couple of seconds, and there's a gibs sound.
- **Blood from the blood pack.** Its blood texture and its spray are built in:
  - drops fly, land, and leave splats on the ground that last about 10 seconds;
  - kills, headshots, blasts and torn-off limbs throw a big burst;
  - every hit sprays, and the wounded leave a trail when they crawl.
- Gore off still turns blood and dismemberment off; bodies still fall as ragdolls.

## v9.10 (Ragdoll deaths)

- **Bodies fall with physics.** Every body gets a few seconds of physics of its own, then lies still and costs nothing
  more. At most 12 bodies are simulated at once; any more just drop flat as before.
  - A man shot from the front goes over backwards; shot from behind, he falls on his face. He topples with the
    weight of the blow, slams down, bounces a little, and settles.
  - His arms, legs and head lag behind the body as it falls, flail on impact, then flop flat. Each body comes to
    rest in its own pose (arms out, one arm up, legs apart, and so on).
  - A grenade throws him and he somersaults through the air, then lands flat.
  - With a wall where he'd land, he falls another way. Pinned in a corner, he slumps against the wall.
  - A man killed where he already lay wounded stays down.
- **The wounded drop to the ground.** A man who goes down wounded now falls and thumps down instead of snapping flat.
- Tested on a real server: front, behind, wall and blast cases all fall the right way, and all bodies are still
  within about a second and a half.

## v9.9 (Blood you can actually see, dismemberment that renders, bodies that never shove anyone)

- **Dismemberment renders now.** The torn-off limb was invisible: hiding the body also hid the arms and head that
  hang off it in the model. Bodies now use their own models: a body missing its head, an arm or a leg, and the
  limb on its own, centred so it lies where it lands. A thrown limb tumbles through the air and settles flat.
- **Dismemberment a bit more often, where it makes sense.** A big blow with lots to spare can now take an arm or a
  leg (12%). Any rifle headshot with a lot to spare can take the head (12%), and a sniper's 35%. Blasts are as
  before.
- **Blood spray you can see.** The old drops were a twentieth of a block and gone at once. Now every hit throws:
  - a spray of bigger drops that fall and land;
  - a red mist puff on the side the round came out;
  - a pool of blood on the ground behind him, which stays about 15 seconds and fades.
  The hit that drops a man wounded bleeds too (it never did: that blow is cancelled). A kill bleeds more, and a
  torn-off limb sprays the most. A wounded man crawling leaves a trail.
- **Bodies never shove the living.** They used to push you and the men around off the spot they landed on. Now a
  man or a pig standing where a body lands doesn't move at all (tested on a real server: 1.17 blocks before, 0
  now), and you can't push bodies around either.
- **Bodies can't be broken.** Punches, fire and lava leave them. A grenade throws nearby bodies away from it instead
  of deleting them. They take no armour or items when you use them.
- Gore off still turns all of this off.

## v9.8 (Outright kills that make sense, wounded who actually crawl, blood you can see)

- **Outright kills by the force of the blow.** v9.7 almost always left a wounded man: a headshot was the main way
  to die outright, and soldiers aim at the chest; a player's own gun pack bullets killed outright only 12% of the
  time. Now:
  - A blow far bigger than what he had left kills outright (80%): a second round into a man already hurt, buckshot
    at close range, a big hit from your own gun. One that only just takes him down leaves him wounded.
  - A blast kills outright and throws the body away from it, the harder the closer he was. Very close tears him
    apart (about half the time), and a limb lands a little way off. Every explosion now records where it went
    off.
  - Rifle and sniper headshots kill outright (75%). A sniper's headshot with power to spare sometimes takes the
    head (25%). Buckshot at point blank sometimes takes an arm or a leg (20%).
  - On a real server, about 55% of lethal hits now kill outright (25 of 45 over three 8-v-8 fights). A grenade at a
    man's feet tore one apart.
- **The wounded really crawl.**
  - They were pinned where they fell: every half second the game put them back if they'd moved more than 0.6
    blocks, so the crawl never got anywhere. Now the pin moves with him.
  - He's moved in small checked steps (a downed man is too slowed for a push to move him), about 0.6 blocks a
    second, with an arms-pulling crawl animation.
  - It starts far more readily. "In the open" means any enemy near who can see him, or the line of sight from
    where his squad knows the enemy is. With nowhere hidden within 6 blocks, he crawls away from them.
  - In the test, a man downed in plain view dragged himself 2.7 blocks behind a low wall.
- **Blood.** A burst of the game's own red dust now joins the blood spray on every hit, so it shows even if the
  custom spray doesn't.
- Bodies are never targets and never stop a round.

## v9.7 (Squad tactics, roles, two new orders, gunfire by distance, tracers, bodies, blood and dismemberment)

Tested on a real Bedrock server. The bounding numbers come from 10 fights per version on the same map: a squad
ordered down a terrace's stairs to a bridge 40 blocks from six posted riflemen, with pillars and low walls on the
way.

- **Bounding.**
  - A squad on the move, in contact and under fire (4+ riflemen, the enemy 14-80 blocks off) first lays 2 s of
    covering fire from everyone.
  - Then two teams take turns: one dashes 3-8 blocks to real cover ("Cover me!") while the other stays put and keeps
    the enemy's heads down. They swap about every 3.5 s until 14 blocks out, then the assault goes in.
  - A man with no cover to dash to stays and covers. A dashing man pinned in the open may still dive for cover.
  - The MG and the sniper cover from their own spots.
  - Result: 8 of 10 won with 4.4 men left on average, against 7 of 10 and 4.0 before.
- **Falling back by bounds.** Two or more men pulling back with the enemy in sight take turns: half turn and fire
  for ~3 s while the rest run. A man under 30% health just runs.
- **Covered routes.** On first contact, anyone still walking a route worked out before the enemy was known
  re-plans it once, keeping out of the enemy's sight where there's a way.
- **Pin and flank.**
  - A squad that's losing, or mostly pinned down for 3 s, calls nearby free squads, who come in from the side.
  - Fixed: enemies a squad only heard about on the radio counted as "busy with our own fight", so no squad ever
    came to help.
- **A grenade up the stairs.** A stack at the foot of the stairs with an enemy known near the top lobs a grenade up
  first, and goes once it's gone off.
- **Sniper and MG.**
  - A sniper moves to a new spot after three shots from the same one.
  - The MG sets up 10 blocks to the side of its squad, with a line on the enemy, so its fire crosses their front.
- **The wounded crawl.** A downed man the enemy can see inches (about a third of a block a second) to a spot 2-5
  blocks away out of their sight. Not while someone is dragging him or a medic is coming.
- **A sergeant.** One man runs each squad. If he goes down in a fight, the squad hesitates ~5 s (no new plan, no
  bounding, slower decisions) until the next man takes over ("Follow me!").
- **Morale.** A squad that wins a fight with hardly a loss is braver and pushes harder for a minute. One that lost
  half its men is jumpier for a minute.
- **New orders.**
  - "Cover the spot I'm looking at": they stay on their order, face that spot, and anything that shows up there
    comes first (2 minutes).
  - "Hold fire until I shoot": they hold fire until you fire a gun or bow or hit anyone, then everyone opens up at
    once.
- **Gunfire by distance.** Each player hears every shot by distance:
  - the sharp report within 40 blocks;
  - the distant one from the right direction out to 120;
  - a faint, low crack out to 260.
- **Tracers at night.** Bullet tracers glow orange in the dark.
- **Bodies.** A soldier who dies leaves a body in his own uniform, lying where he fell. The hit or blast throws it a
  little, and it slides, falls and gets shoved like anything else. Bodies stay a minute, with never more than 24 at
  once (the oldest go first), and have no brain, so they cost next to nothing.
- **Outright kills, blood, dismemberment.**
  - Not every lethal hit leaves a wounded man. These kill outright:
    - a rifle or sniper headshot (60%);
    - a shotgun blast within 5 blocks (35%);
    - a big explosion (50%);
    - now and then a burst of MG fire or any other hit.
  - Blood sprays on every hit.
  - Rarely a limb comes off: from a grenade or shell (about 1 in 6 of those kills), a sniper's headshot (about 1 in
    14), or a point-blank shotgun (about 1 in 20). The body is missing it, and it lies a little way off.
  - War Table -> Settings -> Gore turns the blood and the limbs off. Bodies and outright kills stay either way.

## v9.6 (Falling back ends when it's safe; smoke over an ordered move)

- **Falling back ends when the danger's gone.** A man pulled back only once his health was over 75%, and alone he
  heals about 1 point every 17 s, so a badly wounded man hid for minutes with nobody after him. Now he also goes
  back to his order as soon as it's safe: no enemy within 12 blocks, not hit for 15 s, and no fight going on for his
  squad. He keeps healing on the way. In the test, men at 5/20 health went back within 2-10 s of it going quiet.
- **Smoke over an ordered move.** When most of a squad is on its way to an ordered spot across open ground (the
  enemy 16+ blocks off), under fire, one man throws smoke ahead of them on the way, once per order ("Smoke out!").
- **What was tried and left out.** Two other versions were tested on a real server, with a squad ordered down a
  terrace's stairs to a bridge 40 blocks from six posted riflemen:
  - Making the squad keep walking under the smoke instead of fighting lost every run (0 of 2).
  - Smoke thrown in front of a squad that was still standing lost every run (0 of 3): the dug-in enemy kept
    firing into the cloud.
  - The old behaviour won 3 of 5, and so does this version (3 of 5). The men weren't slow to move: the first one
    was down the stairs in about 4 s. They stop on the way because they fight the enemy that's shooting at them.
- Test kit: new real-server scenarios `bridge` and `retreat`.

## v9.5 (New voice lines: replies, situation callouts, idle back-and-forth, campfire stories)

21 new US English lines, recorded with ElevenLabs in the Luke voice from your workspace (about 860 credits: one take
per line, short lines, few audio tags). Other languages stay silent on these lines until they're recorded; nothing
they already say changes.

- **Replies.** A mate answers:
  - "Target down!" with "Nice shot!"
  - "I'm hit!" with "Hang on, I got you!"
  - "Cover me!" with "On it!"
  - "Hold position!" / "Follow me!" with "Copy that!"
- **Situations.**
  - "Smoke out!" when a smoke grenade goes in.
  - "Breaching! Breaching!" as the stack goes through a door.
  - A whispered "Wait for it..." (heard only 12 blocks away) when an ambush is set, and "Now! Open fire!" when it's
    sprung.
  - "Animal! Put it down!" when a World Animals man-eater comes at them.
  - "Hands where I can see 'em!" from the nearest enemy soldier when someone surrenders.
  - "Mount up!" on the Mount up order.
- **Idle back-and-forth.** Three questions join the idle chatter, and a mate answers each one:
  - "What's the first thing you're eating when we get home?" / "My mom's cooking. Nothing else even comes close."
  - "It's too quiet out here." / "Don't jinx it, man."
  - "You write home yet?" / "Every night. Never send 'em, though."
- **Campfire stories.** Two stories (the night-watch pig, and grandpa's boots). After a story, a mate laughs it off or
  groans "You tell that one every single time." A `story.ogg` of your own in a language folder is still used where no
  recorded story exists.
- Subtitles (War Table -> Callouts) show every new line in English.

## v9.4 (No more huddling when idle, World Animals in sync: shooting and riding, any saddled mount)

- **No huddling.**
  - The v9.2 campfire walked men to seats round a fire, which bunched them up. Now nobody walks anywhere: when two
    to six men of a squad have stood still where they are for a minute, within 5 blocks of each other (no fight
    near, a player around), one sometimes lights a fire on a free patch of open ground between them, and each sits
    down on the spot he's standing on, facing it. Any order or sign of a fight gets them up; the fire goes out after
    3-5 minutes. The story at the fire stays.
  - Idle men on a hold, post, sentry or stand order who end up on top of a squad mate (closer than 1.6 blocks) take a
    step or two straight away from him, on safe ground. Before, only men in a fight made room.
- **World Animals v2 (`Joeishelping/Animals`) and War Engine work together.**
  - Soldiers shoot its man-eaters (lions, tigers, leopards, panthers, bears, hyenas, hippos, crocodiles, komodo
    dragons, snakes, sharks) before they get close: gunners from 16 blocks, others from 9. Before, soldiers never
    saw any of its animals, even one mauling them, because none of them is a "monster".
  - Any of its animals that attacks one of ours is fought back. Deer, birds, zebras, elephants and the like are
    left alone otherwise.
  - A tamed animal of your faction or an ally's is never shot, even if it bites someone by mistake. A pet of a
    faction you're not at war with is left alone unless it attacks.
  - Riding them (from v9.3) was checked in the real game: a tamed, saddled elephant takes a soldier on "Mount up"
    and carries him 35 blocks to the ordered spot.
- **Soldiers aim at a mob's middle.** Every mob was aimed at as if it were a man (1.2 blocks up), so rounds went
  over lions, spiders and slimes. Now the aim height comes from each kind's own eye height. In the test, 9 of 13
  rounds hit a charging lion; it died before it reached anyone.
- **Ride anything.** Besides horses, donkeys, mules, camels, pigs, boats, striders (new) and World Animals mounts,
  soldiers now get on any saddled mount from any add-on on "Mount up".

## v9.3 (Soldiers ride other add-ons' animals)

- **Soldiers ride World Animals mounts.** Any animal from another add-on with the type family `war_mount` counts
  as a mount, like a horse: once it's tamed and saddled, "Mount up" and followers riding off with you put soldiers
  on it, and it carries them at its own walking speed (clamped to 0.15-0.36). World Animals v2 gives that family to
  its elephants, mammoth, rhino, giraffe, ostrich and big cats.
- Right-clicking one of those animals while a soldier sits on it hands it over to you, as with a horse.

## v9.2 (Riding fixed for players, soldiers in the add-on's vehicles, campfires, smoke only to breach or pull back, less lag)

Checked in the simulator (all 10 acceptance checks pass) and on a real Bedrock server.

- **You can ride again.**
  - Right-click a horse, camel, pig or boat a soldier is sitting on: he gets off and you get on. If there's a spare
    seat, he climbs back on behind you.
  - Soldiers no longer jump onto a free mount you're standing next to.
- **"Mount up" includes this add-on's truck, gunboat and helicopter.** Soldiers ride as passengers; you drive.
  When your followers mount up on their own because you rode off, they still only take vanilla mounts.
- **Riding positions.** The seats on the truck (cab and bed), the gunboat and the helicopter were lowered, so the
  men sit in the vehicle instead of floating above it.
- **Campfires.**
  - Three or more men of a squad who've stood in one place for a minute (a post, a hold, a patrol that stopped),
    with no fight near and a player around, sometimes light a fire on open ground.
  - They sit round it, facing the fire. Now and then one of them tells a story; this is the only place that line
    is used.
  - Any order, sign of a fight, retreat or surrender gets them up at once.
  - The fire goes out after 3 to 5 minutes, or when fewer than two men are left at it. A fire left from before a
    reload is put out.
  - The story recording goes in `War Engine RP/sounds/war_voice/<language>/story.ogg`. Until it's there the line
    stays silent.
- **Patrols keep walking.** Before, an enemy merely heard far away stopped a patrol in place. Now only a real fight
  does: an enemy seen in the last 10 s, the squad firing, or a threat in sight.
- **Smoke only to breach or pull back.**
  - Kept: a breach on a door the enemy covers, and a screen when most of the squad is falling back with the enemy in
    sight (8 to 40 blocks).
  - Removed: smoke for an assault, a flank, being pinned down, or a wounded man.
  - A rescuer whose wounded mate is under fire now waits for a lull instead.
- **Less lag.** Soldiers more than 96 blocks from every player think and look around half as often. Their fights
  still play out.
- **Creative menu.** Every War Engine item is now in one collapsible "War Engine" group.

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
