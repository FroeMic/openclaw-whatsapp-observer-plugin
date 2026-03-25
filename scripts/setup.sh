#!/usr/bin/env bash
set -euo pipefail

ACCOUNT_ID="${1:-personal}"

echo ""
echo "WhatsApp Pro — Account Setup"
echo "============================="
echo ""
echo "Account ID: $ACCOUNT_ID"
echo ""

# Prompt for account type
echo "Account type:"
echo "  1) normal   — full agent pipeline (receives messages, agent replies)"
echo "  2) observer — passive logging only (no sessions, no replies, no sends)"
echo ""
read -rp "Choose [1/2] (default: 2): " CHOICE

case "$CHOICE" in
  1|normal)
    MODE="normal"
    ;;
  *)
    MODE="observer"
    ;;
esac

echo ""
echo "Configuring '$ACCOUNT_ID' as $MODE account..."
echo ""

# Stop gateway if running
openclaw gateway stop 2>/dev/null || true

# Bootstrap config
openclaw config set channels.whatsapp.accounts."$ACCOUNT_ID".enabled true

if [ "$MODE" = "observer" ]; then
  openclaw config set channels.whatsapp.accounts."$ACCOUNT_ID".observerMode true
else
  openclaw config set channels.whatsapp.accounts."$ACCOUNT_ID".dmPolicy pairing
fi

# Ensure plugin is enabled
openclaw config set plugins.entries.whatsapp-pro.enabled true

echo ""
echo "Config updated. Starting WhatsApp login..."
echo "Scan the QR code with your phone (WhatsApp > Linked Devices > Link a Device)"
echo ""

# Login
openclaw channels login --channel whatsapp --account "$ACCOUNT_ID"

echo ""
echo "$MODE account '$ACCOUNT_ID' is linked."
echo ""
echo "Start the gateway:"
echo "  openclaw gateway restart"
echo ""
if [ "$MODE" = "observer" ]; then
  echo "Verify observer is running:"
  echo "  tail -f /tmp/openclaw/openclaw-\$(date +%Y-%m-%d).log | grep -i observer"
fi
