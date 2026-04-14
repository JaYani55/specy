#!/usr/bin/env bash
# setup.sh — service-cms first-time setup launcher (Linux / macOS)
#
# Usage:  bash setup.sh
#    or:  chmod +x setup.sh && ./setup.sh

set -euo pipefail

# ── Colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

info()    { echo -e "  ${CYAN}[INFO]${RESET}  $*"; }
ok()      { echo -e "  ${GREEN}[OK]${RESET}    $*"; }
warn()    { echo -e "  ${YELLOW}[WARN]${RESET}  $*"; }
error()   { echo -e "  ${RED}[ERROR]${RESET} $*" >&2; }

# ── Header ───────────────────────────────────────────────────────────────────
echo ""
echo -e "  ${BOLD}service-cms setup${RESET}"
echo    "  -----------------"
echo ""

# ── Check Node.js ────────────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  error "Node.js is not installed or not in PATH."
  echo ""
  echo    "  Install it from: https://nodejs.org/"
  echo    "  Recommended: LTS version 20 or higher."
  echo ""
  echo    "  On Debian/Ubuntu:  sudo apt install nodejs npm"
  echo    "  On Arch:           sudo pacman -S nodejs npm"
  echo    "  On macOS:          brew install node"
  echo    "  Via nvm:           nvm install --lts"
  echo ""
  exit 1
fi

NODE_VERSION="$(node --version)"
ok "Node.js ${NODE_VERSION} found."

# ── Check npm ────────────────────────────────────────────────────────────────
if ! command -v npm &>/dev/null; then
  error "npm is not available. Re-install Node.js from https://nodejs.org/"
  exit 1
fi

NPM_VERSION="$(npm --version)"
ok "npm ${NPM_VERSION} found."

# ── Resolve script directory (works with symlinks) ───────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── Install dependencies if node_modules is missing ──────────────────────────
if [ ! -d "node_modules" ]; then
  echo ""
  info "node_modules not found — running npm install first…"
  echo ""
  if ! npm install; then
    error "npm install failed."
    exit 1
  fi
fi

# ── Run the interactive setup wizard ─────────────────────────────────────────
echo ""
if ! npm run setup; then
  echo ""
  error "Setup exited with an error. Fix the issues above and re-run setup.sh."
  exit 1
fi
