# Approved list: status (v9.19-v9.20)

Numbers are from the 100-item list. "Done" items were tested on a real server unless marked otherwise.

## Reported problems
1-4. Sleep (a third at a time, beds, never in the rain, spread out, rifles away): done (v9.19)
5. Signal Flag (sneak + scroll, no menu): done (v9.19; scrolling needs a real player, signals tested)
6-7. Bodies (no pop in view, slow sink only when far too many, no double at death): done (v9.19)
8-10. Lag: loops timed; cosmetic loops only near players and off on Low; health components cached
   (game calls in a 90 v 90 battle ~505 -> ~440 a tick); 92 dead client checks removed. The one budgeted
   scheduler (9) was not built: the core loops already have their own budgets; noted as partial.
- Jitter / second-guessing (asked for as top priority): done (v9.20): decisions 19 -> 5 a minute, flip-flops
  3.2 -> 0, target switches 10 -> 1.2, big head swings on the march 12.7 -> 0, in a fight 7.2 -> 0.3

## Names and identity
11-15: done (v9.19). 16 (English rank title) dropped at your request: ranks stay in the faction's language.
- Faction people (primary language + skin, optional second and third group): done (v9.20)
- American Infantry (Black) skin, slot 18: added (v9.20)

## AI behaviour and feel
21-30, 36-38: done (v9.19). 24 sentries walk a beat: done.
31 snipers: they kneel (a prone pose points the gun at the sky; that was removed in v6.0).
32-35, 39: were already in (MG setup pause added; leaning/peeking, door stacks with a grenade, covered routes).
40 ladders/walls under fire: no change this round.

## Combat
41-43, 45-49, 55-57, 59-60: done (v9.19). 42 fixed in v9.20 for full blocks.

## Command
65, 68, 69, 70: done (v9.20)

## Modes and world
72 Attack/Defend, 73 Wave survival, 74 Escort (a VIP soldier; no supply truck yet), 75 HQ, 77 watch rotation: done (v9.20)

## Visual and sound
81-90: done (v9.20). 89 stumps: client-side model, not testable on the server.

## Code quality
92, 95, 96, 97, 98, 99, 100: done (v9.20)
91 split main.js: started (names.js, voices.js, guide.js); the rest of main.js is still one file
93 shared cache layer: the health-component cache; the rest is as before
94 dead code: the old cavalry body's client checks removed; MG-nest code is still used by vehicle gun seats

## v9.21: hesitation audit (after the roadmap)
A real-server audit of every kind of NPC (kit scenario `audit`: stalls, dithering, head flicks, decision flips) and
the fixes it led to: prisoners following their captor, followers keeping up and going round walls, men facing their
path while walking, cavalry and vehicle-seat heads, medics, patrols, scouts, the MG flank move, holding a house.
Known and left as is: the game's own walking takes a random 0.2-3 s to set off after a man is given somewhere new to
go (a per-tick script start was tried and dropped: it cost too much in big battles and didn't measurably help);
in the kit's 8-on-8 house siege the attackers never reach the defenders' floor (same before; in the simulator's
assault they now do, 3 of 4 runs); acceptance check 4 fails about one run in three, the same as v9.20.2.
