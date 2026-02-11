#!/usr/bin/env bash
# Quick system health check for onboarding verification

AOS_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$AOS_ROOT"

echo "=== aOS System Verification ==="
echo ""

echo "Dependencies:"
command -v bun &>/dev/null && echo "  bun: OK ($(bun --version))" || echo "  bun: MISSING"
command -v gog &>/dev/null && echo "  gog: OK" || echo "  gog: MISSING (optional)"
echo ""

echo "Directories:"
for dir in context memory workspace .aOS/logs/sessions; do
  [[ -d "$dir" ]] && echo "  $dir: OK" || echo "  $dir: MISSING"
done
echo ""

echo "Configuration:"
[[ -f "prompts/aos-configuration/user.md" ]] && echo "  user.md: OK" || echo "  user.md: MISSING"
[[ -f "prompts/aos-configuration/identity.md" ]] && echo "  identity.md: OK" || echo "  identity.md: MISSING"
[[ -f "memory/MEMORY.md" ]] && echo "  MEMORY.md: OK" || echo "  MEMORY.md: MISSING"
echo ""

echo "Memory System:"
"$AOS_ROOT/.aOS/app/memory/memory" stats 2>/dev/null || echo "  memory stats: FAILED"
echo ""

echo "Google:"
gog auth list 2>/dev/null || echo "  gog auth: NOT CONFIGURED"
