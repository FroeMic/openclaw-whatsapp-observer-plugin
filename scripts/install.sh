#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_DIR="$(dirname "$SCRIPT_DIR")"
EXTENSION_DIR="${HOME}/.openclaw/extensions/whatsapp-pro"

echo ""
echo "WhatsApp Pro — Plugin Install"
echo "=============================="
echo ""

# Disable built-in whatsapp plugin
echo "Disabling built-in whatsapp plugin..."
openclaw plugins disable whatsapp 2>/dev/null || true

# Remove previous install if exists
if [ -d "$EXTENSION_DIR" ]; then
  echo "Removing previous install..."
  rm -rf "$EXTENSION_DIR"
fi

# Install plugin
echo "Installing whatsapp-pro plugin..."
openclaw plugins install "$PLUGIN_DIR"

# Apply symlink workaround for openclaw bug #53685
# (external plugins can't resolve openclaw/plugin-sdk/* without this)
OPENCLAW_ROOT="$(dirname "$(readlink -f "$(which openclaw)")")"
mkdir -p "$EXTENSION_DIR/node_modules"
ln -sf "$OPENCLAW_ROOT" "$EXTENSION_DIR/node_modules/openclaw"

# Install and link wa-pro CLI
echo "Installing wa-pro CLI..."
CLI_DIR="$PLUGIN_DIR/cli"
cd "$CLI_DIR" && npm install --no-fund --no-audit
ln -sf "$CLI_DIR/bin/run.ts" /usr/local/bin/wa-pro
chmod +x "$CLI_DIR/bin/run.ts"

# Ensure tsx is available (required for wa-pro shebang)
if ! command -v tsx &>/dev/null; then
  echo "Installing tsx (required for wa-pro CLI)..."
  npm install -g tsx
fi

if command -v wa-pro &>/dev/null; then
  echo "wa-pro CLI linked successfully."
else
  echo "WARNING: wa-pro not found on PATH after linking."
fi

echo ""
echo "Installed. Next steps:"
echo "  1) Run: bash $SCRIPT_DIR/setup.sh [accountId]"
echo "  2) Then: openclaw gateway restart"
echo ""
echo "To uninstall later:"
echo "  bash $SCRIPT_DIR/uninstall.sh"
echo ""
