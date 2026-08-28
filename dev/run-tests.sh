#!/usr/bin/env bash
# Run the browser test suite headlessly. Needs python3 and Google Chrome.
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${PORT:-8931}"
CHROME="${CHROME:-$(command -v google-chrome || command -v chromium || command -v chromium-browser)}"

python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
sleep 1

"$CHROME" --headless --disable-gpu --no-sandbox --virtual-time-budget=15000 \
  --dump-dom "http://127.0.0.1:$PORT/tests/index.html" 2>/dev/null \
  > /tmp/iso-tests-dom.html

grep -o '<li class="[a-z]*">[^<]*</li>' /tmp/iso-tests-dom.html \
  | sed -e 's|<li class="ok">|PASS  |' -e 's|<li class="ko">|FAIL  |' -e 's|</li>||' \
  | tee /tmp/iso-tests.out
grep -o '<div id="summary"[^>]*>[^<]*</div>' /tmp/iso-tests-dom.html \
  | sed -e 's|<[^>]*>||g' -e 's|^|\n|'

if grep -q '^FAIL' /tmp/iso-tests.out; then exit 1; fi
if ! grep -qE '^PASS' /tmp/iso-tests.out; then echo "aucun test executé"; exit 1; fi
exit 0
