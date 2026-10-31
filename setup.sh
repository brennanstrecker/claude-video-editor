#!/usr/bin/env bash
# setup.sh: check what the editor needs, install the Python packages, create
# the folders from config.json and link the skill into Claude Code.
set -euo pipefail

REPO="$(cd "$(dirname "$0")" && pwd)"
ok() { printf '  ok  %s\n' "$1"; }
fail() { printf '  --  %s\n' "$1"; exit 1; }

echo "Checking what the editor needs:"
[[ "$(uname)" == "Darwin" ]] || fail "this editor runs on a Mac only"
ok "macOS"

command -v node >/dev/null || fail "Node is missing: install Node 18 or newer (https://nodejs.org)"
[[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 18 ]] || fail "Node 18 or newer is needed (you have $(node -v))"
ok "Node $(node -v)"

command -v python3 >/dev/null || fail "Python 3 is missing: install it from https://www.python.org"
ok "$(python3 --version)"

command -v swiftc >/dev/null || fail "Apple's Swift compiler is missing: run  xcode-select --install  and try again"
ok "Swift compiler"

echo "Installing the Python packages (faster-whisper, imageio-ffmpeg, fonttools):"
python3 -m pip install --user --quiet --upgrade faster-whisper imageio-ffmpeg fonttools
ok "Python packages"

echo "Creating the folders from config.json:"
node --input-type=module -e "
  import { mkdirSync } from 'node:fs';
  import { CONFIG, RAW, READY, WORK } from '$REPO/edit/lib.mjs';
  for (const d of [RAW, READY, WORK, WORK + '/plans']) { mkdirSync(d, { recursive: true }); console.log('  ok  ' + d); }
"

echo "Linking the skill into Claude Code:"
mkdir -p "$HOME/.claude/skills"
ln -sfn "$REPO/skill" "$HOME/.claude/skills/video-edit"
ok "$HOME/.claude/skills/video-edit -> $REPO/skill"

cat <<'EOF'

Done. Next:
  1. Check the three folders in config.json are where you want them.
  2. Start Claude Code and say "set up my video profile".
  3. Put a video's clips in a new folder inside your raw folder and say "edit <folder name>".
The first edit downloads the speech models (about 1 GB), once.
EOF
