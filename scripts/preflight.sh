#!/usr/bin/env bash
#
# Read-only production preflight.
#
# Reports whether the deployment is configured, never what the values are. Every
# check is presence or shape only: no secret is printed, logged or echoed, and
# nothing is written to the database or the container.
#
#   ./scripts/preflight.sh                     # inspect the running container
#   CONTAINER=postaryx ./scripts/preflight.sh
#
set -uo pipefail

CONTAINER="${CONTAINER:-postaryx}"
PROJECT="${PROJECT:-postaryx-prod}"
EXPECTED_PUBLIC_URL="${EXPECTED_PUBLIC_URL:-https://app.postaryx.com}"

pass=0
fail=0

ok()   { printf '  [\033[32mPASS\033[0m] %s\n' "$1"; pass=$((pass+1)); }
no()   { printf '  [\033[31mFAIL\033[0m] %s\n' "$1"; fail=$((fail+1)); }
warn() { printf '  [\033[33mWARN\033[0m] %s\n' "$1"; }

# Read one env var from inside the container WITHOUT emitting its value.
# Prints only a classification.
probe() {
  local name="$1"
  docker exec "$CONTAINER" sh -c \
    'if [ -z "${'"$name"':-}" ]; then echo MISSING; else echo "SET:${#'"$name"'}"; fi' \
    2>/dev/null || echo UNREACHABLE
}

# Compare a var against an expected value inside the container, returning only
# MATCH / DIFFERENT so the actual value never crosses the boundary.
matches() {
  local name="$1" expected="$2"
  docker exec "$CONTAINER" sh -c \
    '[ "${'"$name"':-}" = "'"$expected"'" ] && echo MATCH || echo DIFFERENT' \
    2>/dev/null || echo UNREACHABLE
}

echo
echo "=== container ==="
if docker inspect "$CONTAINER" >/dev/null 2>&1; then
  ok "container '$CONTAINER' exists"
  printf '         image: %s\n' "$(docker inspect "$CONTAINER" --format '{{.Config.Image}}')"
  printf '         digest: %s\n' "$(docker inspect "$CONTAINER" --format '{{index .Image}}')"
  printf '         compose project: %s\n' \
    "$(docker inspect "$CONTAINER" --format '{{index .Config.Labels "com.docker.compose.project"}}')"
else
  no "container '$CONTAINER' not found"
  echo; echo "cannot continue without the container"; exit 1
fi

echo
echo "=== secrets present (never printed) ==="
for v in FACEBOOK_APP_SECRET SENTRY_DSN; do
  case "$(probe "$v")" in
    MISSING)     no  "$v is not set" ;;
    UNREACHABLE) no  "$v could not be read" ;;
    SET:*)       ok  "$v is set (length withheld intentionally)" ;;
  esac
done

echo
echo "=== routing ==="
# The deployment names the public origin MAIN_URL and FRONTEND_URL; both feed
# the OAuth and callback URLs handed to Meta, so both must be the real origin.
for v in MAIN_URL FRONTEND_URL; do
  case "$(matches "$v" "$EXPECTED_PUBLIC_URL")" in
    MATCH)     ok "$v matches $EXPECTED_PUBLIC_URL" ;;
    DIFFERENT) no "$v does not match $EXPECTED_PUBLIC_URL" ;;
    *)         no "$v could not be read" ;;
  esac
done
case "$(matches NEXT_PUBLIC_BACKEND_URL "$EXPECTED_PUBLIC_URL/api")" in
  MATCH)     ok "NEXT_PUBLIC_BACKEND_URL is $EXPECTED_PUBLIC_URL/api (status URLs will resolve to the backend)" ;;
  DIFFERENT) no "NEXT_PUBLIC_BACKEND_URL is not $EXPECTED_PUBLIC_URL/api — Meta would get an unreachable status URL" ;;
  *)         no "NEXT_PUBLIC_BACKEND_URL could not be read" ;;
esac

echo
echo "=== reconciler ==="
case "$(matches RUN_CRON true)" in
  MATCH)     ok "RUN_CRON=true — the reconciler will start" ;;
  DIFFERENT) no "RUN_CRON is not 'true' — neither the Meta reconciler nor missingPostWorkflow will start" ;;
  *)         no "RUN_CRON could not be read" ;;
esac

replicas=$(docker ps --filter "label=com.docker.compose.project=$PROJECT" \
                     --filter "label=com.docker.compose.service=postaryx" -q 2>/dev/null | wc -l)
if [ "$replicas" -eq 1 ]; then
  ok "exactly one 'postaryx' container is running — one logical reconciler"
elif [ "$replicas" -eq 0 ]; then
  no "no 'postaryx' container is running under project '$PROJECT'"
else
  warn "$replicas 'postaryx' containers running; Temporal's fixed workflow ID still permits only one reconciler, but confirm this is intended"
fi

echo
echo "=== startup safety ==="
# Decided inside node and reported as a word, never via the exit status of a
# shell builtin: an earlier version used `grep <<<` under `sh`, which has no
# here-strings, so the check errored and its failure was read as "no prisma
# found" — the one gate that matters reported PASS on a container that does run
# `prisma db push --accept-data-loss` at every start.
startup=$(docker exec "$CONTAINER" node -e \
  'const s=(require("/app/package.json").scripts||{})["pm2-run"]||"";
   process.stdout.write(!s ? "NOSCRIPT" : (/prisma/.test(s) ? "PRISMA" : "CLEAN"));' \
  2>/dev/null) || startup=UNREACHABLE

case "$startup" in
  CLEAN)    ok "the running image's pm2-run contains no prisma command" ;;
  PRISMA)   no "the running image still runs prisma on startup — db push would execute on restart" ;;
  NOSCRIPT) no "the running image has no pm2-run script — cannot confirm startup safety" ;;
  *)        no "startup command could not be read (got '${startup:-empty}') — treat as unsafe" ;;
esac

echo
printf '=== %d passed, %d failed ===\n' "$pass" "$fail"
[ "$fail" -eq 0 ] || exit 1
