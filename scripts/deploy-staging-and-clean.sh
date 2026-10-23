#!/usr/bin/env bash
#
# Deploy the current local commit to staging, then reclaim old images.
#
#   ./scripts/deploy-staging-and-clean.sh              deploy HEAD, keep 1 rollback image
#   ./scripts/deploy-staging-and-clean.sh --keep 0     deploy, then remove every older image
#   ./scripts/deploy-staging-and-clean.sh --keep 3     deploy, keep the 3 newest older images
#   ./scripts/deploy-staging-and-clean.sh --clean-only prune without deploying
#   ./scripts/deploy-staging-and-clean.sh --require-published
#                                                      refuse an unpushed commit
#   ./scripts/deploy-staging-and-clean.sh --dry-run    print what would happen
#
# Why this exists: deploy-staging.sh deliberately never deletes an image, so
# every deploy leaves another ~8.8 GB behind. Pruning by hand means pasting a
# sha, and pasting the wrong one takes staging down — the running image is the
# only copy, because the VPS never pulls (`pull_policy: never`).
#
# The interlock that makes this safe: the image currently referenced by the
# running container is resolved on the VPS and excluded from deletion by
# construction, so no mistyped argument can remove it. Retention is counted
# over the *remaining* images, newest first.
#
# `--keep 1` is the default on purpose. That one image is the rollback target
# deploy-staging.sh prints on failure; dropping to 0 means a bad deploy has
# nothing to fall back to.
set -Eeuo pipefail

SSH_HOST="${POSTARYX_SSH_HOST:-contabo}"
IMAGE_REPO="${POSTARYX_IMAGE_REPO:-ghcr.io/aitechnologysys-sys/veroza}"
KEEP=1
DRY_RUN=false
CLEAN_ONLY=false
# Local-first by default: this wrapper exists to deploy whatever is committed
# here, pushed or not. Pass --require-published to restore the origin check.
REQUIRE_PUBLISHED=false
PASSTHRU=()

cd "$(dirname "$0")/.."

c() { printf '\033[%sm%s\033[0m\n' "$1" "$2"; }
info() { c '0;36' "==> $*"; }
ok()   { c '0;32' "  ok  $*"; }
warn() { c '0;33' "  !   $*"; }
die()  { c '0;31' "  xx  $*"; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --keep) KEEP="${2:?--keep needs a number}"; shift ;;
    --keep=*) KEEP="${1#*=}" ;;
    --clean-only) CLEAN_ONLY=true ;;
    --require-published) REQUIRE_PUBLISHED=true ;;
    --dry-run) DRY_RUN=true; PASSTHRU+=("--dry-run") ;;
    -h|--help) sed -n '3,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) PASSTHRU+=("$1") ;;
  esac
  shift
done

case "$KEEP" in ''|*[!0-9]*) die "--keep must be a non-negative integer, got '$KEEP'" ;; esac

rsh() { ssh -o BatchMode=yes -o ConnectTimeout=20 "$SSH_HOST" "$@"; }

# ----------------------------------------------------------------- deploy --
if ! $CLEAN_ONLY; then
  BRANCH="$(git rev-parse --abbrev-ref HEAD)"
  SHA="$(git rev-parse HEAD)"
  info "deploying ${SHA:0:7} on '$BRANCH' to $SSH_HOST"

  # POSTARYX_BRANCH makes deploy-staging.sh's branch guard follow whatever
  # branch is checked out, instead of its hardcoded default.
  if ! $REQUIRE_PUBLISHED; then
    if ! git branch -r --contains "$SHA" >/dev/null 2>&1 \
       || ! git branch -r --contains "$SHA" 2>/dev/null | grep -q .; then
      warn "${SHA:0:7} is not on origin — deploying it anyway (--require-published to refuse)"
    fi
    PASSTHRU+=("--allow-unpublished")
  fi

  POSTARYX_BRANCH="$BRANCH" ./scripts/deploy-staging.sh --yes "${PASSTHRU[@]}" \
    || die "deploy failed — nothing was pruned, the previous image is untouched"
  ok "deploy finished"
else
  SHA=""
  info "--clean-only: skipping deploy"
fi

$DRY_RUN && { warn "dry run: stopping before prune"; exit 0; }

# ------------------------------------------------------------------ prune --
info "resolving the image the container is actually running"
RUNNING="$(rsh "docker inspect postaryx --format '{{.Config.Image}}'" 2>/dev/null || true)"
[ -n "$RUNNING" ] || die "could not read the running image — refusing to delete anything"
ok "running: $RUNNING"

# A deploy that silently no-ops would leave the old image running; deleting
# "older" images then means deleting the one that was just built.
if [ -n "$SHA" ] && [ "$RUNNING" != "$IMAGE_REPO:$SHA" ]; then
  die "expected $IMAGE_REPO:${SHA:0:7} to be running, found $RUNNING — refusing to prune"
fi

CANDIDATES="$(rsh "docker images '$IMAGE_REPO' --format '{{.Tag}}' | grep -vx '$(echo "${RUNNING##*:}")' || true")"
[ -n "$CANDIDATES" ] || { ok "no other images present; nothing to reclaim"; exit 0; }

TOTAL="$(printf '%s\n' "$CANDIDATES" | wc -l | tr -d ' ')"
DOOMED="$(printf '%s\n' "$CANDIDATES" | tail -n +$((KEEP + 1)))"

info "$TOTAL other image(s); keeping $KEEP as rollback"
if [ -z "$DOOMED" ]; then ok "nothing to remove"; exit 0; fi

printf '%s\n' "$DOOMED" | while read -r tag; do
  [ -n "$tag" ] || continue
  warn "removing $IMAGE_REPO:${tag:0:12}"
  rsh "docker rmi '$IMAGE_REPO:$tag'" >/dev/null 2>&1 \
    && ok "removed ${tag:0:12}" || warn "could not remove ${tag:0:12} (in use?)"
done

info "disk after"
rsh "docker system df | head -3; df -h / | tail -1"
