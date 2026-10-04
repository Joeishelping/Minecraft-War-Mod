# Real-game tests (Bedrock Dedicated Server)

1. Download the Linux Bedrock Dedicated Server into a folder (e.g. `/opt/bds`). Set in `server.properties`:
   `level-name=wartest`, `allow-cheats=true`, `content-log-console-output-enabled=true`, `online-mode=false`.
2. `sh tests/bds/make.sh "<scripts folder of the version>" /opt/bds`: installs a TEST copy of the War Engine with
   `kit.js` appended (gunners keep their guns without the gun pack; the pack's bullets become arrows).
3. `sh tests/bds/start.sh /opt/bds v81`: starts the server; its console is the FIFO `/tmp/v81.in`.
4. `sh tests/bds/suite.sh v81`: runs every scenario; one JSON line each in `/tmp/v81.results`.
   One scenario by hand: `echo "scriptevent war:test bigSiege trace=400" > /tmp/v81.in` (trace prints positions,
   decisions and route-planner statistics to the log).
5. Profile: `echo "script profiler start" > /tmp/v81.in`, later `... stop`; then
   `python3 tests/bds/prof.py <server>/profiles/<file>.cpuprofile`.

`results_*_real.jsonl` are the runs behind the v8.1 changelog.
