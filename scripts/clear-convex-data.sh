#!/usr/bin/env bash
#
# clear-convex-data.sh
#
# DESTRUCTIVE: deletes ALL documents from ALL tables on a Convex deployment,
# while leaving the schema/tables themselves (and any deployed functions)
# intact. Under the hood this uses `npx convex import --table <table>
# --replace --format jsonArray` with an empty array for every table defined
# in convex/schema.ts, which is the officially supported way to bulk-clear a
# table without writing/deploying any custom mutation code.
#
# This targets whichever deployment `npx convex` is currently configured for
# (see .env.local -> CONVEX_DEPLOYMENT, currently `dev:stoic-puffin-862`,
# i.e. https://stoic-puffin-862.eu-west-1.convex.cloud). Pass --prod to target
# this project's production deployment instead, or --deployment <name> for a
# specific one (same flags `npx convex` itself accepts).
#
# USAGE:
#   ./scripts/clear-convex-data.sh                 # clear dev deployment
#   ./scripts/clear-convex-data.sh --prod           # clear prod deployment
#   ./scripts/clear-convex-data.sh --deployment prod
#   ./scripts/clear-convex-data.sh --skip-auth-tables   # keep users/sessions/etc.
#
# You will be asked to type CONFIRM before anything is deleted.
#
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# Tables defined directly in convex/schema.ts (see the defineSchema({...}) block).
APP_TABLES=(
  businesses
  leads
  projects
  voiceSessions
  transcripts
  requirements
  requirementVersions
  buildJobs
  buildProgressEvents
  deployments
  notifications
  activityEvents
  integrationEvents
  assets
  revisionRequests
  revisionAssets
  whatsappMessages
  workflowRuns
  stageAttempts
  webhookEvents
  callAttempts
  repositories
  generatedDocuments
  siteTenants
  siteSubmissions
  externalCallResponses
  externalReplayRequests
  externalCallSettings
)

# Tables added by `authTables` from @convex-dev/auth (spread into the schema).
# These hold login sessions/accounts for the admin app - clearing them will
# sign every user out. Skip with --skip-auth-tables if you don't want that.
AUTH_TABLES=(
  users
  authAccounts
  authSessions
  authRefreshTokens
  authVerificationCodes
  authRateLimits
)

CONVEX_FLAGS=()
SKIP_AUTH_TABLES=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-auth-tables)
      SKIP_AUTH_TABLES=1
      shift
      ;;
    --prod)
      CONVEX_FLAGS+=(--prod)
      shift
      ;;
    --deployment)
      CONVEX_FLAGS+=(--deployment "$2")
      shift 2
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

TABLES=("${APP_TABLES[@]}")
if [[ "$SKIP_AUTH_TABLES" -eq 0 ]]; then
  TABLES+=("${AUTH_TABLES[@]}")
fi

echo "About to permanently delete ALL documents from ${#TABLES[@]} table(s)"
echo "on deployment flags: ${CONVEX_FLAGS[*]:-<default: dev, from .env.local>}"
echo
printf '  - %s\n' "${TABLES[@]}"
echo
read -r -p "Type CONFIRM to proceed: " CONFIRMATION
if [[ "$CONFIRMATION" != "CONFIRM" ]]; then
  echo "Aborted. No data was deleted."
  exit 1
fi

TMP_EMPTY_FILE="$(mktemp -t convex-empty-XXXXXX.json)"
echo "[]" > "$TMP_EMPTY_FILE"
trap 'rm -f "$TMP_EMPTY_FILE"' EXIT

for table in "${TABLES[@]}"; do
  echo "==> Clearing table: $table"
  npx convex import \
    --table "$table" \
    --format jsonArray \
    --replace \
    --yes \
    "${CONVEX_FLAGS[@]+"${CONVEX_FLAGS[@]}"}" \
    "$TMP_EMPTY_FILE"
done

echo
echo "Done. All listed tables have been cleared."
