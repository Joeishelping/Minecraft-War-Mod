#!/usr/bin/env python3
"""Packs War Engine BP + RP into one .mcaddon (same layout as the releases: two pack folders inside)."""
import json, os, sys, zipfile
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ver = json.load(open(os.path.join(root, "War Engine BP", "manifest.json")))["header"]["version"]
out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(root, "dist", f"War_Engine_v{ver[0]}_{ver[1]}.mcaddon")
os.makedirs(os.path.dirname(out), exist_ok=True)
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for pack in ("War Engine BP", "War Engine RP"):
        for dp, _, files in os.walk(os.path.join(root, pack)):
            for f in sorted(files):
                full = os.path.join(dp, f)
                z.write(full, os.path.relpath(full, root))
print(out)
