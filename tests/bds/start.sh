#!/bin/sh
# start.sh <server dir> <name>: runs the server with its console on the FIFO /tmp/<name>.in, log in /tmp/<name>.log
SRV="$1"; N="$2"
rm -f /tmp/$N.in; mkfifo /tmp/$N.in
cd "$SRV" && LD_LIBRARY_PATH=. nohup sh -c "tail -f /tmp/$N.in | ./bedrock_server" > /tmp/$N.log 2>&1 &
