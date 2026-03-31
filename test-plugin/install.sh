#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ID="test-tool-plugin"

echo ""
echo "Test Tool Plugin — Install"
echo "==========================="
echo ""

echo "Installing $PLUGIN_ID plugin..."
openclaw plugins install "$SCRIPT_DIR"

echo ""
echo "Installed. Restart the gateway to load:"
echo "  openclaw gateway restart"
echo ""
echo "To uninstall later:"
echo "  bash $SCRIPT_DIR/uninstall.sh"
echo ""
