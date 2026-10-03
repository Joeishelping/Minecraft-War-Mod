// Headless check of Vice Pack's script: uses each item, runs the timers, and fails on any thrown error.
import { fire, advance, player, LOG } from "@minecraft/server";
import fs from "node:fs";
// main.js has to sit next to node_modules to find the mock
fs.copyFileSync(new URL("../../Vice Pack BP/scripts/main.js", import.meta.url), new URL("./main.copy.js", import.meta.url));
await import("./main.copy.js");
const use = (id) => fire("use", { source: player, itemStack: { typeId: "vice:" + id } });
const count = (k, v) => LOG.filter((l) => l[0] === k && (v === undefined || l[1] === v)).length;
const items = ["beer", "liquor", "cigarette", "cigar", "cocaine", "ketamine", "opium"];
for (const i of items) { use(i); advance(40); }
advance(20 * 70);
// overdoses
use("cocaine"); use("cocaine"); use("cocaine"); advance(20);
use("liquor"); use("liquor"); use("liquor"); advance(40);
advance(20 * 300);
const msgs = LOG.filter((l) => l[0] === "msg").map((l) => l[1]);
console.log(msgs.join("\n"));
console.log({ effects: count("effect"), fades: count("fade"), particles: count("particle"), cmds: count("cmd"), knocks: count("knock"), bars: count("bar") });
const ok = msgs.some((m) => m.includes("cocaine overdose")) && msgs.some((m) => m.includes("alcohol poisoning")) && msgs.some((m) => m.includes("rush is gone"))
  && ["vice:smoke_puff", "vice:smoke_wisp", "vice:ember", "vice:powder", "vice:swirl"].every((p) => count("particle", p) > 0) && count("knock") > 0 && count("error") === 0;
for (const l of LOG) if (l[0] === "error") console.error("API misuse:", l[1]);
// script swallows errors in safe(); make sure every particle/effect call actually went through by checking the counts above
if (!ok) { console.error("FAIL"); process.exit(1); }
console.log("OK");
