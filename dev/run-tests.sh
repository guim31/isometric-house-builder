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
SUMMARY=$(grep -o '<div id="summary"[^>]*>[^<]*</div>' /tmp/iso-tests-dom.html \
  | sed -e 's|<[^>]*>||g')
printf '\n%s\n' "$SUMMARY"

if grep -q '^FAIL' /tmp/iso-tests.out; then exit 1; fi
if ! grep -qE '^PASS' /tmp/iso-tests.out; then echo "aucun test executé"; exit 1; fi
# The summary starts as an ellipsis and is written when the last test returns.
# Without this check a run that dies partway — an application that throws on
# boot leaves the page tests waiting for a frame that never becomes ready —
# reports a screen of passes, no failures, and a clean exit code.
if [ -z "$SUMMARY" ] || [ "$SUMMARY" = "…" ]; then
  echo "la suite ne s'est pas terminée : $(grep -c '^PASS' /tmp/iso-tests.out) tests exécutés"
  exit 1
fi
exit 0
