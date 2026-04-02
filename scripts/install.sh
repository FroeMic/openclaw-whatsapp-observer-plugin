#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_DIR="$(dirname "$SCRIPT_DIR")"
EXTENSION_DIR="${HOME}/.openclaw/extensions/whatsapp-pro"
CONFIG_PATH="${HOME}/.openclaw/openclaw.json"

# --- Parse flags ---
MIGRATE=""  # empty = prompt, "yes" = --migrate, "no" = --no-migrate
for arg in "$@"; do
  case "$arg" in
    --migrate)    MIGRATE="yes" ;;
    --no-migrate) MIGRATE="no" ;;
    --help|-h)
      echo "Usage: install.sh [OPTIONS]"
      echo ""
      echo "Install the WhatsApp Pro plugin into an existing openclaw installation."
      echo ""
      echo "Options:"
      echo "  --migrate      Migrate existing channels.whatsapp config to whatsapp-pro"
      echo "  --no-migrate   Disable built-in whatsapp without migrating config"
      echo "  -h, --help     Show this help"
      echo ""
      echo "If neither flag is given and channels.whatsapp config exists, you will be prompted."
      exit 0
      ;;
    *)
      echo "Unknown option: $arg (use --help for usage)"
      exit 1
      ;;
  esac
done

echo ""
echo "WhatsApp Pro — Plugin Install"
echo "=============================="
echo ""

# --- Backup config (same pattern as openclaw doctor) ---
if [ -f "$CONFIG_PATH" ]; then
  BACKUP_PATH="${CONFIG_PATH}.pre-whatsapp-pro.bak"
  cp "$CONFIG_PATH" "$BACKUP_PATH"
  echo "Config backed up to: $BACKUP_PATH"
fi

# --- Check for existing whatsapp config and decide migration ---
HAS_WA_CONFIG=$(node -e "
  const fs = require('fs');
  try {
    const cfg = JSON.parse(fs.readFileSync('$CONFIG_PATH', 'utf8'));
    const wa = cfg.channels?.whatsapp;
    // Has meaningful config (not just {enabled: false})
    const hasAccounts = wa?.accounts && Object.keys(wa.accounts).length > 0;
    const hasPolicy = wa?.dmPolicy || wa?.groupPolicy || wa?.allowFrom;
    console.log(hasAccounts || hasPolicy ? 'yes' : 'no');
  } catch { console.log('no'); }
" 2>/dev/null || echo "no")

if [ "$HAS_WA_CONFIG" = "yes" ] && [ -z "$MIGRATE" ]; then
  echo "Existing WhatsApp channel config found (channels.whatsapp)."
  read -rp "Migrate to whatsapp-pro? [Y/n]: " CHOICE
  case "$CHOICE" in
    [nN]|[nN][oO]) MIGRATE="no" ;;
    *)             MIGRATE="yes" ;;
  esac
elif [ "$HAS_WA_CONFIG" = "no" ]; then
  MIGRATE="no"
fi

# --- Check whether built-in whatsapp was enabled (before we touch anything) ---
WA_WAS_ENABLED=$(node -e "
  const fs = require('fs');
  try {
    const cfg = JSON.parse(fs.readFileSync('$CONFIG_PATH', 'utf8'));
    const hasChannel = cfg.channels?.whatsapp !== undefined;
    const pluginDisabled = cfg.plugins?.entries?.whatsapp?.enabled === false;
    console.log(hasChannel && !pluginDisabled ? 'true' : 'false');
  } catch { console.log('false'); }
" 2>/dev/null || echo "false")
echo "Built-in whatsapp was previously enabled: $WA_WAS_ENABLED"

# --- Migrate or disable built-in whatsapp ---
if [ "$MIGRATE" = "yes" ]; then
  echo "Migrating channels.whatsapp → channels.whatsapp-pro..."
  node -e "
    const fs = require('fs');
    const configPath = '$CONFIG_PATH';
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));

    const waConfig = cfg.channels?.whatsapp;
    if (!waConfig) {
      console.log('  No channels.whatsapp to migrate.');
      process.exit(0);
    }

    // Copy whatsapp config to whatsapp-pro (preserve observer if already present)
    const existing = cfg.channels['whatsapp-pro'] || {};
    const migrated = { ...waConfig, ...existing };
    delete migrated.enabled;  // whatsapp-pro manages its own enable state

    cfg.channels['whatsapp-pro'] = migrated;
    delete cfg.channels.whatsapp;

    // Also clean up plugins.entries.whatsapp
    if (cfg.plugins?.entries?.whatsapp) {
      delete cfg.plugins.entries.whatsapp;
    }

    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2) + '\n');
    const accountCount = Object.keys(migrated.accounts || {}).length;
    console.log('  Migrated ' + accountCount + ' account(s) to channels.whatsapp-pro');
    console.log('  Removed channels.whatsapp');
  "
else
  echo "Disabling built-in whatsapp plugin..."
  openclaw plugins disable whatsapp 2>/dev/null || true
  # Clean up the stale config entries left by 'plugins disable'
  node -e "
    const fs = require('fs');
    const configPath = '$CONFIG_PATH';
    if (!fs.existsSync(configPath)) process.exit(0);
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    let changed = false;
    if (cfg.channels?.whatsapp) {
      delete cfg.channels.whatsapp;
      changed = true;
    }
    if (cfg.plugins?.entries?.whatsapp) {
      delete cfg.plugins.entries.whatsapp;
      changed = true;
    }
    if (changed) {
      fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2) + '\n');
      console.log('  Cleaned up stale whatsapp config entries.');
    }
  " 2>/dev/null || true
fi

# --- Remove previous install if exists ---
if [ -d "$EXTENSION_DIR" ]; then
  echo "Removing previous install..."
  rm -rf "$EXTENSION_DIR"
fi

# --- Clean up stale whatsapp-pro config from previous installs ---
# openclaw plugins install validates config before installing. If a previous
# install left channels.whatsapp-pro in config but the extension dir was removed,
# openclaw rejects it as "unknown channel id". Remove it so install succeeds.
node -e "
  const fs = require('fs');
  const configPath = '$CONFIG_PATH';
  if (!fs.existsSync(configPath)) process.exit(0);
  const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  let changed = false;
  if (cfg.channels?.['whatsapp-pro']) {
    delete cfg.channels['whatsapp-pro'];
    if (Object.keys(cfg.channels).length === 0) delete cfg.channels;
    changed = true;
  }
  if (cfg.plugins?.entries?.['whatsapp-pro']) {
    delete cfg.plugins.entries['whatsapp-pro'];
    if (cfg.plugins.entries && Object.keys(cfg.plugins.entries).length === 0) delete cfg.plugins.entries;
    changed = true;
  }
  if (Array.isArray(cfg.plugins?.allow)) {
    const before = cfg.plugins.allow.length;
    cfg.plugins.allow = cfg.plugins.allow.filter(id => id !== 'whatsapp-pro');
    if (cfg.plugins.allow.length < before) changed = true;
    if (cfg.plugins.allow.length === 0) delete cfg.plugins.allow;
  }
  if (cfg.plugins && Object.keys(cfg.plugins).length === 0) delete cfg.plugins;
  if (changed) {
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2) + '\n');
    console.log('  Cleaned up stale whatsapp-pro config from previous install.');
  }
" 2>/dev/null || true

# --- Install plugin ---
echo "Installing whatsapp-pro plugin..."
openclaw plugins install "$PLUGIN_DIR"

# Apply symlink workaround for openclaw bug #53685
# (external plugins can't resolve openclaw/plugin-sdk/* without this)
OPENCLAW_ROOT="$(dirname "$(readlink -f "$(which openclaw)")")"
mkdir -p "$EXTENSION_DIR/node_modules"
ln -sf "$OPENCLAW_ROOT" "$EXTENSION_DIR/node_modules/openclaw"

# --- Ensure built-in whatsapp is fully disabled ---
# The gateway auto-enables built-in whatsapp when it detects credentials.
# Explicitly disable the plugin AND remove the channel config to prevent this.
echo "Ensuring built-in whatsapp is disabled..."
openclaw plugins disable whatsapp 2>/dev/null || true
openclaw config unset channels.whatsapp 2>/dev/null || true
# Also clean up the stale plugins.entries.whatsapp left by 'plugins disable'
node -e "
  const fs = require('fs');
  const configPath = '$CONFIG_PATH';
  if (!fs.existsSync(configPath)) process.exit(0);
  const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  if (cfg.plugins?.entries?.whatsapp) {
    delete cfg.plugins.entries.whatsapp;
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2) + '\n');
  }
" 2>/dev/null || true

# --- Save meta (after plugin is installed so openclaw knows the channel ID) ---
node -e "
  const fs = require('fs');
  const configPath = '$CONFIG_PATH';
  if (!fs.existsSync(configPath)) process.exit(0);
  const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));

  if (!cfg.channels) cfg.channels = {};
  if (!cfg.channels['whatsapp-pro']) cfg.channels['whatsapp-pro'] = {};
  if (!cfg.channels['whatsapp-pro'].meta) cfg.channels['whatsapp-pro'].meta = {};
  cfg.channels['whatsapp-pro'].meta.previousWhatsappEnabled = $WA_WAS_ENABLED;

  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2) + '\n');
" 2>/dev/null || true

# --- Install root dependencies (needed by CLI imports into src/observer/) ---
echo "Installing plugin dependencies..."
cd "$PLUGIN_DIR" && npm install --no-fund --no-audit

# --- Install and link wa-pro CLI ---
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
