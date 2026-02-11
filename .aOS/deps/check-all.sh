#!/usr/bin/env bash
set -euo pipefail

DEPS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FORCE="${1:-}"

echo "=== aOS Dependency Check ==="
echo ""

# Track if any updates are available
UPDATES=0

for dep_dir in "$DEPS_DIR"/*/; do
  [ -d "$dep_dir" ] || continue
  dep_name=$(basename "$dep_dir")
  dep_json="$dep_dir/dep.json"
  check_script="$dep_dir/check-update.sh"

  # Skip if no dep.json or check script
  [ -f "$dep_json" ] || continue
  [ -f "$check_script" ] || continue

  # Check if we should skip (weekly interval) unless --force
  if [ "$FORCE" != "--force" ]; then
    LAST_CHECK=$(python3 -c "
import json, sys
from datetime import datetime, timezone
d = json.load(open('$dep_json'))
last = d.get('lastCheckDate')
interval = d.get('autoCheckIntervalDays', 7)
if not last:
    print('check')
    sys.exit()
try:
    last_dt = datetime.fromisoformat(last.replace('Z', '+00:00'))
    now = datetime.now(timezone.utc)
    days = (now - last_dt).days
    if days >= interval:
        print('check')
    else:
        print(f'skip:{interval - days}')
except:
    print('check')
" 2>/dev/null)

    if [[ "$LAST_CHECK" == skip:* ]]; then
      DAYS_LEFT="${LAST_CHECK#skip:}"
      RESULT=$(python3 -c "import json; print(json.load(open('$dep_json')).get('lastCheckResult', 'unknown'))" 2>/dev/null)
      if [ "$RESULT" = "update-available" ]; then
        echo "$dep_name: update available (last checked, next check in ${DAYS_LEFT}d)"
        UPDATES=$((UPDATES + 1))
      fi
      continue
    fi
  fi

  # Run the check
  bash "$check_script"
  RESULT=$(python3 -c "import json; print(json.load(open('$dep_json')).get('lastCheckResult', 'unknown'))" 2>/dev/null)
  if [ "$RESULT" = "update-available" ]; then
    UPDATES=$((UPDATES + 1))
  fi
done

echo ""
if [ $UPDATES -gt 0 ]; then
  echo "$UPDATES update(s) available. Run install.sh for each to update."
else
  echo "All dependencies up to date."
fi
