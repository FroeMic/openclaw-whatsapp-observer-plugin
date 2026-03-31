#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ID="test-tool-plugin"
EXTENSION_DIR="${HOME}/.openclaw/extensions/${PLUGIN_ID}"

echo ""
echo "Test Tool Plugin — Uninstall"
echo "============================="
echo ""

echo "Removing plugin registration..."
openclaw plugins uninstall "$PLUGIN_ID" --force 2>/dev/null || true

# Remove leftover extension directory if it still exists
if [ -d "$EXTENSION_DIR" ]; then
  echo "Removing plugin files..."
  rm -rf "$EXTENSION_DIR"
fi

echo ""
echo "Uninstalled. Restart the gateway to apply:"
echo "  openclaw gateway restart"
echo ""
