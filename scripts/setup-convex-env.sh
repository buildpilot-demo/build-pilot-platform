#!/usr/bin/env bash
#
# setup-convex-env.sh
#
# Interactively sets the environment variables this Convex deployment needs
# (see README.md's "Environment variables" table and the `process.env.*`
# reads across convex/*.ts) using `npx convex env set`. Values are never
# hard-coded here - you'll be prompted for each one and can just press
# Enter to leave it unset (existing values on the deployment are left
# untouched if you skip).
#
# This targets whichever deployment `npx convex` is currently configured for
# (see .env.local -> CONVEX_DEPLOYMENT, currently `dev:stoic-puffin-862`,
# i.e. https://stoic-puffin-862.eu-west-1.convex.cloud). Pass --prod to target
# this project's production deployment instead, or --deployment <name> for a
# specific one (same flags `npx convex` itself accepts).
#
# USAGE:
#   ./scripts/setup-convex-env.sh                  # dev deployment
#   ./scripts/setup-convex-env.sh --prod            # prod deployment
#   ./scripts/setup-convex-env.sh --deployment prod
#   ./scripts/setup-convex-env.sh --all             # also prompt for optional tuning vars
#
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

CONVEX_FLAGS=()
INCLUDE_OPTIONAL_TUNING=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --all)
      INCLUDE_OPTIONAL_TUNING=1
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

# name|description|secret(1/0)
CORE_VARS=(
  "CONTEXTDEV_API_KEY|Business search (Context.dev) API key|1"
  "CONTEXTDEV_BASE_URL|Context.dev API base URL (optional override)|0"
  "ELEVENLABS_API_KEY|ElevenLabs API key for outbound voice calls|1"
  "ELEVENLABS_AGENT_ID|ElevenLabs conversational agent ID|0"
  "ELEVENLABS_AGENT_PHONE_NUMBER_ID|ElevenLabs outbound phone number ID|0"
  "ELEVENLABS_BASE_URL|ElevenLabs API base URL (optional override)|0"
  "ELEVENLABS_WEBHOOK_SECRET|Secret used to verify ElevenLabs post-call webhooks|1"
  "ELEVENLABS_MOCK_CONVERSATION|Set to Y to mock calls instead of using real ElevenLabs/Twilio (optional, default N)|0"
  "TWILIO_ACCOUNT_SID|Twilio account SID (telephony + WhatsApp)|0"
  "TWILIO_AUTH_TOKEN|Twilio auth token|1"
  "TWILIO_STATUS_CALLBACK_URL|Twilio status callback URL (optional override)|0"
  "LLM_PROVIDER|LLM provider for requirements extraction: openai, groq, or gemini (optional, default openai)|0"
  "LLM_MODEL|LLM model name (optional, defaults per provider: gpt-4o-mini / llama-3.3-70b-versatile / gemini-1.5-flash)|0"
  "OPENAI_API_KEY|OpenAI API key for requirements extraction (required when LLM_PROVIDER=openai)|1"
  "OPENAI_BASE_URL|OpenAI API base URL (optional override)|0"
  "GROQ_API_KEY|Groq API key for requirements extraction (required when LLM_PROVIDER=groq)|1"
  "GROQ_BASE_URL|Groq API base URL (optional override)|0"
  "GEMINI_API_KEY|Gemini API key for requirements extraction (required when LLM_PROVIDER=gemini)|1"
  "GEMINI_BASE_URL|Gemini API base URL (optional override)|0"
  "GITHUB_TOKEN|GitHub token used to create repos from the starter template|1"
  "GITHUB_ORG|GitHub org that generated repositories are created under|0"
  "GITHUB_STARTER_REPO|GitHub starter template repo (owner/name)|0"
  "GITHUB_REPO_VISIBILITY|public or private (optional, default private)|0"
  "DEVIN_API_KEY|Devin API key for automated build sessions|1"
  "DEVIN_API_BASE_URL|Devin API base URL (optional override)|0"
  "FIREBASE_PROJECT_ID|Firebase project ID that generated sites deploy to|0"
  "FIREBASE_SITE_ID|Firebase Hosting site ID (optional, if not using prefix)|0"
  "FIREBASE_SITE_PREFIX|Shared Firebase Hosting site prefix for generated sites|0"
  "GENERATED_SITE_CONVEX_URL|Client URL of the separate buildpilot-sites Convex deployment used by generated sites|0"
  "CONVEX_CALLBACK_TOKEN|Shared secret this deployment expects on inbound webhook callbacks|1"
)

OPTIONAL_TUNING_VARS=(
  "DEFAULT_CALL_PHONE|Fallback phone number used for calls (optional)|0"
  "CALLING_WINDOW_START_HOUR|Earliest local hour calls may be placed (optional, default 9)|0"
  "CALLING_WINDOW_END_HOUR|Latest local hour calls may be placed (optional, default 18)|0"
  "VOICE_CALL_MAX_ATTEMPTS|Max retry attempts for a voice call (optional, default 3)|0"
  "DEVIN_STATUS_POLL_INTERVAL_MS|Devin session status poll interval ms (optional, default 5000)|0"
  "DEVIN_SESSION_TIMEOUT_MS|Devin session timeout ms (optional, default 1800000)|0"
  "CANDIDATE_VALIDATION_POLL_INTERVAL_MS|Candidate validation poll interval ms (optional, default 15000)|0"
  "CANDIDATE_VALIDATION_TIMEOUT_MS|Candidate validation timeout ms (optional, default 1800000)|0"
  "BUILD_DISPATCH_WATCHDOG_MS|Build dispatch watchdog timeout ms (optional, default 600000)|0"
  "REPOSITORY_VALIDATION_POLL_INTERVAL_MS|Repository validation poll interval ms (optional, default 15000)|0"
  "REPOSITORY_VALIDATION_TIMEOUT_MS|Repository validation timeout ms (optional, default 900000)|0"
  "WHATSAPP_DELIVERY_POLL_INTERVAL_MS|WhatsApp delivery poll interval ms (optional, default 15000)|0"
  "WHATSAPP_DELIVERY_TIMEOUT_MS|WhatsApp delivery timeout ms (optional, default 900000)|0"
  "FIREBASE_DEPLOY_POLL_INTERVAL_MS|Firebase deploy poll interval ms (optional, default 15000)|0"
  "FIREBASE_DEPLOY_TIMEOUT_MS|Firebase deploy timeout ms (optional, default 900000)|0"
  "GENERATED_SITE_BACKEND_VERSION|Backend version tag written into generated sites (optional, default v1)|0"
)

VARS=("${CORE_VARS[@]}")
if [[ "$INCLUDE_OPTIONAL_TUNING" -eq 1 ]]; then
  VARS+=("${OPTIONAL_TUNING_VARS[@]}")
fi

echo "Setting Convex environment variables on deployment flags: ${CONVEX_FLAGS[*]:-<default: dev, from .env.local>}"
echo "Press Enter on any prompt to skip it (leaves any existing value untouched)."
echo

for entry in "${VARS[@]}"; do
  IFS='|' read -r name description secret <<< "$entry"
  echo "$name - $description"
  if [[ "$secret" -eq 1 ]]; then
    read -r -s -p "  value (hidden, Enter to skip): " value
    echo
  else
    read -r -p "  value (Enter to skip): " value
  fi

  if [[ -z "$value" ]]; then
    echo "  skipped."
    echo
    continue
  fi

  npx convex env set --force "${CONVEX_FLAGS[@]+"${CONVEX_FLAGS[@]}"}" "$name" "$value"
  echo "  set."
  echo
done

echo "Done."
