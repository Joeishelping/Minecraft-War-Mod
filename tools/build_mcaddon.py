#!/usr/bin/env python3
"""Packs War Engine BP + RP into one .mcaddon (same layout as the releases: two pack folders inside).

Before packing it checks every script the way the game loads it (as an ES module: a duplicate top-level name, which
plain `node --check` misses, stops the whole script from loading in game) and that every JSON file parses. Any
failure stops the build. Pass --test to also run the battle simulator's acceptance checks (one seed) first.
"""
import json, os, shutil, subprocess, sys, tempfile, zipfile
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
args = [a for a in sys.argv[1:] if not a.startswith("--")]
ver = json.load(open(os.path.join(root, "War Engine BP", "manifest.json")))["header"]["version"]
out = args[0] if args else os.path.join(root, "dist", f"War_Engine_v{ver[0]}_{ver[1]}" + (f"_{ver[2]}" if ver[2] else "") + ".mcaddon")


def fail(msg):
    print(f"BUILD STOPPED: {msg}", file=sys.stderr)
    sys.exit(1)


# 1) JSON files must parse (the game skips a broken one silently)
for pack in ("War Engine BP", "War Engine RP"):
    for dp, _, files in os.walk(os.path.join(root, pack)):
        for f in files:
            if f.endswith(".json"):
                try:
                    json.load(open(os.path.join(dp, f), encoding="utf-8"))
                except Exception as err:
                    fail(f"{os.path.relpath(os.path.join(dp, f), root)} is not valid JSON: {err}")

# 2) scripts, checked as modules
node = shutil.which("node")
if node:
    scripts = os.path.join(root, "War Engine BP", "scripts")
    with tempfile.TemporaryDirectory() as tmp:
        for dp, _, files in os.walk(scripts):
            for f in files:
                if not f.endswith(".js"):
                    continue
                src = os.path.join(dp, f)
                dst = os.path.join(tmp, os.path.relpath(src, scripts).replace(os.sep, "_")[:-3] + ".mjs")
                shutil.copy(src, dst)
                r = subprocess.run([node, "--check", dst], capture_output=True, text=True)
                if r.returncode != 0:
                    fail(f"{os.path.relpath(src, root)} has a syntax error:\n{r.stderr.strip()[:800]}")
else:
    print("note: node not found, script check skipped", file=sys.stderr)

# 3) optional: the simulator's acceptance checks
if "--test" in sys.argv:
    if not node:
        fail("--test needs node")
    r = subprocess.run([node, os.path.join(root, "tests", "harness", "accept.mjs"), "1", os.path.join(root, "War Engine BP", "scripts")], capture_output=True, text=True, cwd=root)
    print(r.stdout[-1500:])
    if "FAIL  10." in r.stdout or "Error" in r.stderr[-400:]:
        fail("the simulator found script errors or crashes")

os.makedirs(os.path.dirname(out), exist_ok=True)
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for pack in ("War Engine BP", "War Engine RP"):
        for dp, _, files in os.walk(os.path.join(root, pack)):
            for f in sorted(files):
                full = os.path.join(dp, f)
                z.write(full, os.path.relpath(full, root))
print(out)
