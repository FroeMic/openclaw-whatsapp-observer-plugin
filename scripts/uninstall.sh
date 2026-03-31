#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ID="whatsapp-pro"
EXTENSION_DIR="${HOME}/.openclaw/extensions/${PLUGIN_ID}"

KEEP_CONFIG=false
KEEP_FILES=false

for arg in "$@"; do
  case "$arg" in
    --keep-config) KEEP_CONFIG=true ;;
    --keep-files)  KEEP_FILES=true ;;
    --help|-h)
      echo "Usage: uninstall.sh [OPTIONS]"
      echo ""
      echo "Remove the WhatsApp Pro plugin from an existing openclaw installation."
      echo ""
      echo "Options:"
      echo "  --keep-config  Keep channels.whatsapp-pro config in openclaw.json"
      echo "  --keep-files   Keep plugin files on disk (~/.openclaw/extensions/whatsapp-pro)"
      echo "  -h, --help     Show this help"
      exit 0
      ;;
    *)
      echo "Unknown option: $arg (use --help for usage)"
      exit 1
      ;;
  esac
done

echo ""
echo "WhatsApp Pro — Plugin Uninstall"
echo "================================"
echo ""

# Stop gateway so the plugin isn't loaded during removal
echo "Stopping gateway..."
openclaw gateway stop 2>/dev/null || true

# Uninstall via openclaw CLI (removes plugins.entries, plugins.installs, plugins.allow, load paths)
echo "Removing plugin registration..."
if $KEEP_FILES; then
  openclaw plugins uninstall "$PLUGIN_ID" --keep-files --force 2>/dev/null || true
else
  openclaw plugins uninstall "$PLUGIN_ID" --force 2>/dev/null || true
fi

# Remove channel config section (openclaw plugins uninstall doesn't touch channels.*)
if ! $KEEP_CONFIG; then
  echo "Removing channels.whatsapp-pro config..."
  node -e "
    const fs = require('fs');
    const path = require('path');
    const configPath = path.join(process.env.HOME, '.openclaw', 'openclaw.json');
    if (!fs.existsSync(configPath)) {
      console.log('  No openclaw.json found, skipping.');
      process.exit(0);
    }
    const raw = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(raw);
    if (config.channels && config.channels['whatsapp-pro']) {
      delete config.channels['whatsapp-pro'];
      // Clean up empty channels object
      if (Object.keys(config.channels).length === 0) {
        delete config.channels;
      }
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
      console.log('  Removed channels.whatsapp-pro from openclaw.json');
    } else {
      console.log('  No channels.whatsapp-pro config found, skipping.');
    }
  "
else
  echo "Keeping channels.whatsapp-pro config (--keep-config)."
fi

# Remove leftover extension directory if it still exists
if ! $KEEP_FILES && [ -d "$EXTENSION_DIR" ]; then
  echo "Removing plugin files..."
  rm -rf "$EXTENSION_DIR"
fi

# Re-enable built-in whatsapp plugin (reversed from install.sh)
echo "Re-enabling built-in whatsapp plugin..."
openclaw plugins enable whatsapp 2>/dev/null || true

echo ""
echo "Uninstalled. You can restart the gateway:"
echo "  openclaw gateway restart"
echo ""
