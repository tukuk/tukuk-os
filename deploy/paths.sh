#!/usr/bin/env bash
# ==============================================================================
# paths.sh — the ONE folder. Every path the box needs is derived from here, so a
# script that needs the Builder or the game asks this file instead of spelling out
# an absolute path that will be wrong after the next move.
#
#   THE RULE: on the server there is exactly one folder — /opt/tukuk-os. The app is
#   the folder itself; everything else that used to live in its own top-level place
#   is a subdirectory:
#
#     /opt/tukuk-os/apps/builder   was /opt/tukuk-builder      (separate git repo)
#     /opt/tukuk-os/apps/play      was /var/www/tukuk-play     (static game build)
#     /opt/tukuk-os/models         was /home/tukuk/models      (GGUF/ONNX weights)
#     /opt/tukuk-os/bin            was /home/tukuk/bin         (godot binary)
#     /opt/tukuk-os/game           was /home/tukuk/station-break (separate git repo)
#
#   The root is NOT configurable on purpose. scripts/auto-update.sh already refuses
#   to run anywhere but /opt/tukuk-os ("only designed to run in ..."), the systemd
#   units spell it out, and the nightly timer depends on it. A second knob for a
#   value that cannot legally vary is how two of them end up disagreeing.
#
#   Every location below still takes an environment override, because a few callers
#   legitimately need one (a scratch directory in a test, a USB build, a second
#   checkout). The override is the exception; the derived path is the default.
#
#   USAGE (from scripts/):      . "$(cd "$(dirname "$0")/.." && pwd)/deploy/paths.sh"
#   USAGE (from deploy/godot/): . "$(cd "$(dirname "$0")/.." && pwd)/paths.sh"
#
#   The one folder deliberately does NOT contain /var/www/tukuk-mirror: that is the
#   GCP failover VM, a different machine whose paths are none of this box's business.
#   It does not contain /opt/tukuk-agent either, and that is a judgement rather than an
#   oversight: the agent is a 536 MB released binary artifact owned by its own system
#   user (tukuk-agent), sandboxed with ProtectSystem=strict and with its state in
#   /var/lib/tukuk-agent. Moving it rewrites a sandbox, not a path — a different change
#   with a different failure mode, and nothing on this box is waiting for it.
# ==============================================================================

# Sourcing twice (script → helper → script) must not clobber a caller's override.
if [ -n "${TUKUK_PATHS_SH:-}" ]; then
  return 0 2>/dev/null || exit 0
fi

TUKUK_ROOT="${TUKUK_ROOT:-/opt/tukuk-os}"

TUKUK_APPS="${TUKUK_APPS:-$TUKUK_ROOT/apps}"
TUKUK_BUILDER_DIR="${TUKUK_BUILDER_DIR:-$TUKUK_APPS/builder}"
TUKUK_PLAY_DIR="${TUKUK_PLAY_DIR:-$TUKUK_APPS/play}"
TUKUK_MODEL_DIR="${TUKUK_MODEL_DIR:-$TUKUK_ROOT/models}"
TUKUK_BIN_DIR="${TUKUK_BIN_DIR:-$TUKUK_ROOT/bin}"
TUKUK_GAME_DIR="${TUKUK_GAME_DIR:-$TUKUK_ROOT/game}"
TUKUK_GODOT_BIN="${GODOT_BIN:-$TUKUK_BIN_DIR/godot}"
# Downloads land inside the folder too, so a half-finished pull is one `du` away
# instead of hidden in /tmp.
TUKUK_MODEL_STAGING="${TUKUK_MODEL_STAGING:-$TUKUK_ROOT/generated/hf}"

export TUKUK_PATHS_SH=1
export TUKUK_ROOT TUKUK_APPS TUKUK_BUILDER_DIR TUKUK_PLAY_DIR TUKUK_MODEL_DIR \
       TUKUK_BIN_DIR TUKUK_GAME_DIR TUKUK_GODOT_BIN TUKUK_MODEL_STAGING

# The pre-consolidation locations, kept here because exactly two scripts still need
# to name them: the migration that moves them, and the guard test that says they may
# not come back. Nothing else should read these.
TUKUK_LEGACY_BUILDER=/opt/tukuk-builder
TUKUK_LEGACY_PLAY=/var/www/tukuk-play
TUKUK_LEGACY_MODELS=/home/tukuk/models
TUKUK_LEGACY_BIN=/home/tukuk/bin
TUKUK_LEGACY_GAME=/home/tukuk/station-break
export TUKUK_LEGACY_BUILDER TUKUK_LEGACY_PLAY TUKUK_LEGACY_MODELS \
       TUKUK_LEGACY_BIN TUKUK_LEGACY_GAME
