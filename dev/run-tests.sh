#!/usr/bin/env bash
# Kept for the habit and the links to it: the runner is dev/run-tests.mjs,
# which needs Node 22 or later and Chrome, and nothing else.
set -euo pipefail
exec node "$(dirname "$0")/run-tests.mjs" "$@"
