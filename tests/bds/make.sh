#!/bin/sh
# make.sh <scripts dir of the version> <server dir>: installs a TEST copy of the War Engine (that version's scripts +
# the test kit; gunners keep their guns without the gun pack) into <server dir>/worlds/wartest
set -e
SRC="$1"; SRV="$2"; REPO="$(cd "$(dirname "$0")/../.." && pwd)"
BP="$SRV/worlds/wartest/behavior_packs/WarBP"
rm -rf "$BP" && cp -r "$REPO/War Engine BP" "$BP" && rm -rf "$BP/scripts" && cp -r "$SRC" "$BP/scripts"
python3 - "$BP/scripts/main.js" "$REPO/tests/bds/kit.js" <<'PY'
import sys
p, kit = sys.argv[1], sys.argv[2]
s = open(p).read()
old = '      sdp(e, "war:weapon", "crossbow");'
assert old in s
s = s.replace(old, '      setP(e, "war:gun", Math.max(1, GUN_MODELS.indexOf(item.slice(3)) + 1)); return;   // (TEST: no gun pack on the server)')
s += "\n" + open(kit).read()
open(p, "w").write(s)
PY
python3 - "$BP/manifest.json" "$SRV/worlds/wartest/world_behavior_packs.json" <<'PY'
import json, sys
m = json.load(open(sys.argv[1])); h = m["header"]
m["dependencies"] = [d for d in m.get("dependencies", []) if "uuid" not in d]   # (no resource pack on a test server)
json.dump(m, open(sys.argv[1], "w"), indent=2)
json.dump([{"pack_id": h["uuid"], "version": h["version"]}], open(sys.argv[2], "w"))
PY
echo "installed $(basename "$SRC") into $SRV"
