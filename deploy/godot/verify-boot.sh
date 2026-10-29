#!/bin/bash
# Boot proof for play.tukuk.org through the real edge path: headless Chrome on this box,
# the raw-CDP driver in this directory, deadline bounded. Writes a plain-text verdict so
# a caller can poll it, because a run takes minutes and an ssh session that drops should
# not take the evidence with it.
#
#   deploy/godot/verify-boot.sh                      # against the live edge
#   BOOT_URL=http://127.0.0.1:3000/index.html GATE=0 deploy/godot/verify-boot.sh
#
# Chrome is started with swiftshader: this box has no GPU, and without a software
# rasterizer the page reports no WebGL2 context and fails for reasons that have nothing
# to do with the build. --headless=new because the old headless has no CDP Page domain on
# a target of type 'page' until a tab is opened.
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
BOOT_URL=${BOOT_URL:-https://play.tukuk.org/index.html}
OUT=${OUT:-/tmp/boot-out.txt}
PORT=${PORT:-9222}
SHOT=${SHOT:-/tmp/strike-edge-boot.png}
DEADLINE_MS=${DEADLINE_MS:-420000}
# exported so the driver sees them
export BOOT_URL SHOT DEADLINE_MS
export GATE=${GATE:-1}

command -v google-chrome >/dev/null || { echo "FATAL: google-chrome not found on this box" >&2; exit 2; }

# Bracketed por[t] on purpose: a plain pattern matches this script's own command line
# and pkill then kills the session that ran it.
pkill -f "remote-debugging-por[t]=$PORT" 2>/dev/null
sleep 2
rm -rf "/tmp/cdp-play-prof-$PORT"
google-chrome --headless=new --no-sandbox --disable-gpu \
  --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader \
  --remote-debugging-port="$PORT" --user-data-dir="/tmp/cdp-play-prof-$PORT" \
  --window-size=1280,720 about:blank > "/tmp/chrome-$PORT.log" 2>&1 &
CHROME_PID=$!

READY=0
for _ in $(seq 1 30); do
  if curl -s --max-time 5 "http://127.0.0.1:$PORT/json/version" > /dev/null; then READY=1; break; fi
  sleep 1
done
if [ "$READY" != "1" ]; then
  echo "FATAL: chrome never answered /json/version on $PORT -- see /tmp/chrome-$PORT.log" >&2
  kill "$CHROME_PID" 2>/dev/null
  exit 2
fi

CDP_PORT="$PORT" node "$HERE/cdp-boot.js" > "$OUT" 2>&1
RC=$?
echo "DRIVER_RC=$RC" >> "$OUT"
kill "$CHROME_PID" 2>/dev/null
cat "$OUT"
exit $RC
