# Next batch (approved list)

78 items. Numbers are from the 100-item list.

## Reported problems first
1. Sleep only at night, a few men at a time (not the whole squad).
2. Sleepers use beds/tents/shelter nearby; never out in the rain with a roof close.
3. Gun hidden while asleep.
4. Sleepers lie at varied angles and spacing.
5. Hand signals as a hotbar item (Signal Flag): scroll to pick the signal, use to give it, no menu.
6. Dead bodies: find and fix what still looks wrong (popping, sinking, first frame, limb snaps).
7. Bodies never pop away; they sink very slowly, only after a long time out of view.
8. Lag audit on a real server: time every loop added in v9.15-9.18.
9. Merge per-tick loops into one budgeted scheduler.
10. Driver / unit card / ammo / limp / sleep checks only within 48 blocks of a player.

## Names and identity
11. 150-300 surnames per culture.
12. First names (unit card: "Pvt. Miguel Garcia").
13. No duplicate full names within a squad.
14. Veteran nicknames ("Doc", "Lucky") earned from what they did.
15. Mixed-heritage names in mixed factions (setting).
16. English rank title shown alongside on the unit card.

## AI behaviour and feel
21. Idle variety: checking rifle, stretching, looking at a map, talking in pairs.
22. Smoking / eating at camp (setting).
23. Turn toward a squad mate who's talking.
24. Sentries walk a short beat.
25. Quieter/whispered callouts at night near the enemy.
26. Nearby explosion: duck, briefly deafened, slower reactions.
27. Wounded moved by drag OR shoulder carry, whichever fits the situation (distance, fire, terrain).
28. Medic kneels and works on the wounded.
29. Weapons dropped by the dead stay a while; out-of-ammo men pick them up.
30. Captors bandage wounded enemies and take them prisoner more often.
31. Snipers prone on hills/roofs.
32. MG gunner deploys on a wall/window with a short setup pause.
33. Leaning round corners to shoot.
34. Breaching: short pause at the door, then a quick entry in pairs.
35. Grenade into a room before entering, when available.
36. More smoke when retreating.
37. Squads re-form after a battle (regroup on the sergeant).
38. Sergeant's head count on the radio after a fight.
39. Town routing: alleys over open streets when the enemy is about.
40. Ladders/walls under fire without stalls.

## Combat
41. Suppression meter on the unit card.
42. Unified penetration: wood and glass yes, stone no.
43. Ricochet sparks off stone/metal.
45. Accuracy by stance: prone better, running worse.
46. Recoil climb on MG bursts.
47. Melee duels: parry and riposte; shield bash breaks guard.
48. Spear/pike line that stops cavalry charges.
49. Cavalry charge momentum damage; horses rear when hit.
(50: not needed, they already switch to pistol or melee.)
55. Barbed wire item that slows soldiers.
56. Ammo crate item: placeable, soldiers resupply from it.
57. First aid kit item players use on soldiers.
59. Armor visibly damaged after heavy hits.
60. Rare helmet deflection ("ping").

## Command
65. Formation picker in the baton (column / line / wedge / auto).
68. "Follow me" squads keep formation behind the player (like the guard detail).
69. Rally flag placement from the baton.
70. "Return to base" order: everyone back to the faction HQ flag.

## Modes and world
72. Attack/defend scenario builder (town, sides, timer).
73. Wave survival mode.
74. Escort mission (VIP or supply truck).
75. Faction HQ: reinforcements spawn there, soldiers heal and resupply.
77. Day-night routine: guard rotation by day, camp at night.

## Visual and sound
81. Muzzle smoke puffs.
82. Shell casings.
83. Supersonic crack when a round passes near a player.
84. Distant battle rumble when a fight is out of sight.
85. Footstep dust when running.
86. Rain: soldiers look down and huddle.
87. Hit marker sound for players.
88. Blood trails from crawling wounded.
89. Better dismemberment stump textures.
90. Ragdolls slump against walls.

## Code quality, reliability, performance
91. Split main.js into modules.
92. Module-mode syntax check in the build.
93. One shared entity-cache and timing layer.
94. Remove dead code (MG nests, old cavalry bodies).
95. Make the noisy simulator checks reliable.
96. Automated test run on every build.
97. Settings export/import.
98. Soldier identity in one small saved record.
99. Recent script errors shown in the War Table.
100. In-game guide book.
