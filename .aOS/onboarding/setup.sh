#!/usr/bin/env bash
set -euo pipefail

# aOS Setup Script — Installs dependencies and prepares the workspace.
# Personalization happens later via agent-guided onboarding in Claude Code.

AOS_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$AOS_ROOT"

echo "=== aOS Setup ==="
echo ""

# ── Prerequisites ──────────────────────────────────────────────────────

check_prereq() {
  if ! command -v "$1" &>/dev/null; then
    echo "ERROR: $1 is required but not installed."
    echo "  $2"
    exit 1
  fi
}

check_prereq bun "Install via: curl -fsSL https://bun.sh/install | bash"
check_prereq git "Install via: brew install git (macOS) or apt install git (Linux)"

# macOS: check for Homebrew SQLite (needed for sqlite-vec extension)
if [[ "$(uname)" == "Darwin" ]]; then
  BREW_SQLITE="$(brew --prefix sqlite 2>/dev/null || true)"
  if [[ -z "$BREW_SQLITE" || ! -f "$BREW_SQLITE/lib/libsqlite3.dylib" ]]; then
    echo "WARNING: Homebrew SQLite not found. The memory system requires it for extensions."
    echo "  Install via: brew install sqlite"
    echo ""
  else
    echo "Homebrew SQLite: OK ($BREW_SQLITE)"
  fi
fi

echo "bun: $(bun --version)"
echo "git: $(git --version)"
echo ""

# ── Install Dependencies ───────────────────────────────────────────────

echo "Installing dependencies..."
bun install
echo ""

# ── Create Directory Structure ─────────────────────────────────────────

echo "Creating directory structure..."
dirs=(
  "context/projects"
  "context/people"
  "context/areas/companies"
  "context/areas/departments"
  "context/areas/teams"
  "context/resources"
  "context/archives"
  "memory/data"
  "memory/daily-notes"
  "workspace/projects"
  "workspace/research"
  ".aOS/logs/sessions"
)

for dir in "${dirs[@]}"; do
  mkdir -p "$dir"
done
echo "  Directories created."
echo ""

# ── Bootstrap CLAUDE.md ───────────────────────────────────────────────

if [[ ! -f "CLAUDE.md" ]]; then
  cp .aOS/onboarding/CLAUDE.md.bootstrap CLAUDE.md
  echo "Installed bootstrap CLAUDE.md."
elif grep -q "Bootstrap Mode" CLAUDE.md 2>/dev/null; then
  echo "Bootstrap CLAUDE.md already in place."
else
  echo "CLAUDE.md exists (non-bootstrap) — skipping."
fi

# ── Starter MEMORY.md ────────────────────────────────────────────────

if [[ ! -f "memory/MEMORY.md" ]]; then
  cp .aOS/onboarding/templates/MEMORY.md.template memory/MEMORY.md
  echo "Created starter memory/MEMORY.md."
else
  echo "memory/MEMORY.md already exists — skipping."
fi
echo ""

# ── Initialize Vector DB ──────────────────────────────────────────────

echo "Initializing vector database..."
"$AOS_ROOT/.aOS/app/memory/memory" vec sync 2>&1 || echo "  Vector sync skipped (model may need to download on first use)."
echo ""

# ── Health Check ──────────────────────────────────────────────────────

echo "Running health check..."
"$AOS_ROOT/.aOS/app/memory/memory" stats 2>&1 || echo "  Health check failed — see errors above."
echo ""

# ── Done ──────────────────────────────────────────────────────────────

echo "=== Setup Complete ==="
echo ""
echo "Next step: Open Claude Code in this directory to start onboarding."
echo "  cd $AOS_ROOT"
echo "  claude"
echo ""
echo "Then say: \"let's get started\""
