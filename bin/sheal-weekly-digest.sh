#!/bin/bash
# ============================================================================
# sheal-weekly-digest.sh — Standalone weekly digest agent
#
# Runs OUTSIDE Claude Code sessions. Analyzes all chats from the past week,
# categorizes with LLM enrichment, estimates costs, and produces a full report.
#
# Usage:
#   ./bin/sheal-weekly-digest.sh                    # 7-day digest, pretty
#   ./bin/sheal-weekly-digest.sh --since "1 month"  # custom window
#   ./bin/sheal-weekly-digest.sh --slack             # send to Slack
#   ./bin/sheal-weekly-digest.sh --agent             # deep analysis with Claude
#
# Schedule with:
#   /scheduler:schedule-add every Saturday at 10am run: /path/to/sheal-weekly-digest.sh
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SHEAL_ROOT="$(dirname "$SCRIPT_DIR")"

# ── Defaults ──
SINCE="${SINCE:-7 days}"
FORMAT="pretty"
SLACK=""
AGENT_ANALYSIS=""
PROJECT=""
PLAN="Max 20x"
OUTPUT_DIR="$HOME/.sheal/weekly-digests"

# ── Parse args ──
while [[ $# -gt 0 ]]; do
  case "$1" in
    --since)    SINCE="$2"; shift 2 ;;
    --format)   FORMAT="$2"; shift 2 ;;
    --slack)    SLACK=1; shift ;;
    --agent)    AGENT_ANALYSIS=1; shift ;;
    --project)  PROJECT="$2"; shift 2 ;;
    --plan)     PLAN="$2"; shift 2 ;;
    --help|-h)
      echo "Usage: sheal-weekly-digest.sh [options]"
      echo ""
      echo "Options:"
      echo "  --since <window>   Time window (default: '7 days')"
      echo "  --project <name>   Filter to specific project"
      echo "  --plan <plan>      Pro | Max 5x | Max 20x (default: Max 20x)"
      echo "  --format <fmt>     pretty | json | markdown (default: pretty)"
      echo "  --slack            Send report to Slack (needs SHEAL_SLACK_WEBHOOK_URL)"
      echo "  --agent            Run deep analysis with Claude after digest"
      echo "  -h, --help         Show this help"
      exit 0 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

mkdir -p "$OUTPUT_DIR"

DATE=$(date +%Y-%m-%d)
TIMESTAMP=$(date +%Y-%m-%dT%H-%M-%S)
SCOPE="${PROJECT:-global}"

echo "============================================"
echo "  SHEAL WEEKLY DIGEST"
echo "  $(date '+%A %B %d, %Y %H:%M')"
echo "  Window: $SINCE | Scope: $SCOPE"
echo "============================================"
echo ""

# ── Step 1: Generate digest with LLM enrichment ──
echo "[1/4] Generating digest with LLM enrichment..."

DIGEST_ARGS="--since \"$SINCE\" --enrich"
[ -n "$PROJECT" ] && DIGEST_ARGS="$DIGEST_ARGS --project \"$PROJECT\""

# Run digest - save markdown for Slack, pretty for terminal
eval sheal digest $DIGEST_ARGS --format pretty
echo ""

# Also save markdown version
DIGEST_MD="$OUTPUT_DIR/$TIMESTAMP-$SCOPE-digest.md"
eval sheal digest $DIGEST_ARGS --format markdown -o "$DIGEST_MD" 2>/dev/null
echo "  Saved: $DIGEST_MD"

# ── Step 2: Generate cost report ──
echo ""
echo "[2/4] Generating cost report..."

COST_ARGS="--since \"$SINCE\" --plan \"$PLAN\""
[ -n "$PROJECT" ] && COST_ARGS="$COST_ARGS --project \"$PROJECT\""

eval sheal cost $COST_ARGS
echo ""

# Save cost JSON
COST_JSON="$OUTPUT_DIR/$TIMESTAMP-$SCOPE-cost.json"
eval sheal cost $COST_ARGS --format json > "$COST_JSON" 2>/dev/null
echo "  Saved: $COST_JSON"

# ── Step 3: Deep agent analysis (optional) ──
if [ -n "$AGENT_ANALYSIS" ]; then
  echo ""
  echo "[3/4] Running deep analysis with Claude..."

  ANALYSIS_PROMPT="You are analyzing a weekly AI coding session digest. Read the following digest and cost data, then provide:

1. TOP INSIGHTS: What are the 3 most important patterns you see?
2. AUTOMATION OPPORTUNITIES: Which uncategorized items should be automated?
3. COST OPTIMIZATION: Where is money being wasted? Which projects are expensive relative to their value?
4. RECOMMENDATIONS: 5 specific, actionable recommendations for next week.

Be specific, cite session IDs and exact numbers.

--- DIGEST ---
$(cat "$DIGEST_MD")

--- COST DATA ---
$(cat "$COST_JSON")
"

  ANALYSIS_FILE="$OUTPUT_DIR/$TIMESTAMP-$SCOPE-analysis.md"

  # Use claude -p (works fine outside a session)
  echo "$ANALYSIS_PROMPT" | claude -p --model sonnet --output-format text > "$ANALYSIS_FILE" 2>/dev/null

  if [ -s "$ANALYSIS_FILE" ]; then
    echo ""
    echo "============================================"
    echo "  DEEP ANALYSIS"
    echo "============================================"
    cat "$ANALYSIS_FILE"
    echo ""
    echo "  Saved: $ANALYSIS_FILE"
  else
    echo "  Analysis returned empty (might be inside a session — run standalone)"
  fi
else
  echo "[3/4] Skipping deep analysis (use --agent to enable)"
fi

# ── Step 4: Slack notification (optional) ──
if [ -n "$SLACK" ]; then
  echo ""
  echo "[4/4] Sending to Slack..."

  if [ -z "${SHEAL_SLACK_WEBHOOK_URL:-}" ]; then
    echo "  SHEAL_SLACK_WEBHOOK_URL not set. Skipping."
  else
    # Build Slack message from cost JSON
    TOTAL_COST=$(cat "$COST_JSON" | python3 -c "import sys,json; print(f\"\${json.load(sys.stdin)['cost']['totalCost']:.2f}\")" 2>/dev/null || echo "?")
    SESSIONS=$(cat "$COST_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['sessionCount'])" 2>/dev/null || echo "?")
    SAVED=$(cat "$COST_JSON" | python3 -c "import sys,json; s=json.load(sys.stdin)['cost'].get('planSavings',{}); print(f\"\${s.get('saved',0):.0f} ({s.get('savedPercent',0):.0f}%)\")" 2>/dev/null || echo "?")

    SLACK_MSG=$(cat <<SLACKEOF
{
  "blocks": [
    {"type": "header", "text": {"type": "plain_text", "text": "Weekly Claude Digest - $DATE"}},
    {"type": "section", "text": {"type": "mrkdwn", "text": "*Window:* $SINCE | *Sessions:* $SESSIONS | *API Cost:* $TOTAL_COST\n*Saved vs subscription:* $SAVED"}},
    {"type": "divider"},
    {"type": "section", "text": {"type": "mrkdwn", "text": "Full report saved to \`$DIGEST_MD\`\nRun \`sheal browse digests\` to view interactively."}}
  ]
}
SLACKEOF
)

    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
      -H "Content-Type: application/json" \
      -d "$SLACK_MSG" \
      "$SHEAL_SLACK_WEBHOOK_URL")

    if [ "$HTTP_CODE" = "200" ]; then
      echo "  Sent to Slack."
    else
      echo "  Slack webhook returned HTTP $HTTP_CODE"
    fi
  fi
else
  echo "[4/4] Skipping Slack (use --slack to enable)"
fi

echo ""
echo "============================================"
echo "  DONE"
echo "  Reports: $OUTPUT_DIR/$TIMESTAMP-$SCOPE-*"
echo "  Browse:  sheal browse digests"
echo "============================================"
