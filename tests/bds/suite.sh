#!/bin/sh
# suite.sh <name>: runs every scenario one after another on the server /tmp/<name>.in, collecting the WARTEST lines
N="$1"; OUT=/tmp/$N.results; : > $OUT
for sc in "siege mode=out" "siege mode=in" "bigSiege" "trip mode=flat n=30 ticks=4800" "trip mode=down n=8 ticks=2400" "trip mode=up n=8 ticks=2400" "roam" "big n=90 ticks=600"; do
  before=$(grep -c "WARTEST_DONE" /tmp/$N.log)
  echo "scriptevent war:test $sc" > /tmp/$N.in
  i=0; while [ $(grep -c "WARTEST_DONE" /tmp/$N.log) -le $before ] && [ $i -lt 400 ]; do sleep 3; i=$((i+1)); done
  grep "WARTEST {" /tmp/$N.log | tail -1 | sed 's/.*WARTEST //' >> $OUT
  sleep 5
done
echo ALLDONE >> $OUT
