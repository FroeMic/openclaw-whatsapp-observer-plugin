#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ID="whatsapp-pro"
EXTENSION_DIR="${HOME}/.openclaw/extensions/${PLUGIN_ID}"
CONFIG_PATH="${HOME}/.openclaw/openclaw.json"

# --- Parse flags ---
KEEP_FILES=false
PURGE_CREDS=false
MIGRATE=""           # empty = prompt, "yes" = --migrate, "no" = --no-migrate
RESTORE_WA=""        # empty = auto (check state file), "yes" = force, "no" = skip
for arg in "$@"; do
  case "$arg" in
    --migrate)              MIGRATE="yes" ;;
    --no-migrate)           MIGRATE="no" ;;
    --keep-files)           KEEP_FILES=true ;;
    --purge-credentials)    PURGE_CREDS=true ;;
    --restore-whatsapp)     RESTORE_WA="yes" ;;
    --no-restore-whatsapp)  RESTORE_WA="no" ;;
    --help|-h)
      echo "Usage: uninstall.sh [OPTIONS]"
      echo ""
      echo "Remove the WhatsApp Pro plugin from an existing openclaw installation."
      echo ""
      echo "Options:"
      echo "  --migrate              Migrate channels.whatsapp-pro config back to channels.whatsapp"
      echo "                         (observer-only accounts are excluded)"
      echo "  --no-migrate           Remove channels.whatsapp-pro without migrating back"
      echo "  --restore-whatsapp     Re-enable the built-in whatsapp plugin"
      echo "  --no-restore-whatsapp  Do not re-enable the built-in whatsapp plugin"
      echo "  --keep-files           Keep plugin files on disk (~/.openclaw/extensions/whatsapp-pro)"
      echo "  --purge-credentials    Delete WhatsApp Web credentials (~/.openclaw/oauth/whatsapp/)"
      echo "                         Your phone will need to be re-linked after reinstall"
      echo "  -h, --help             Show this help"
      echo ""
      echo "If --restore-whatsapp / --no-restore-whatsapp is not given, the script checks"
      echo "whether whatsapp was enabled before install and only restores if it was."
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

# --- Backup config ---
if [ -f "$CONFIG_PATH" ]; then
  BACKUP_PATH="${CONFIG_PATH}.pre-uninstall-whatsapp-pro.bak"
  cp "$CONFIG_PATH" "$BACKUP_PATH"
  echo "Config backed up to: $BACKUP_PATH"
fi

# --- Stop gateway ---
echo "Stopping gateway..."
openclaw gateway stop 2>/dev/null || true

# --- Remove wa-pro CLI symlink ---
echo "Removing wa-pro CLI..."
rm -f /usr/local/bin/wa-pro 2>/dev/null || true

# --- Check for existing whatsapp-pro config ---
HAS_WA_PRO_CONFIG=$(node -e "
  const fs = require('fs');
  try {
    const cfg = JSON.parse(fs.readFileSync('$CONFIG_PATH', 'utf8'));
    const wa = cfg.channels?.['whatsapp-pro'];
    const hasAccounts = wa?.accounts && Object.keys(wa.accounts).length > 0;
    console.log(hasAccounts ? 'yes' : 'no');
  } catch { console.log('no'); }
" 2>/dev/null || echo "no")

if [ "$HAS_WA_PRO_CONFIG" = "yes" ] && [ -z "$MIGRATE" ]; then
  echo "Existing WhatsApp Pro channel config found."
  read -rp "Migrate accounts back to built-in whatsapp? [Y/n]: " CHOICE
  case "$CHOICE" in
    [nN]|[nN][oO]) MIGRATE="no" ;;
    *)             MIGRATE="yes" ;;
  esac
elif [ -z "$MIGRATE" ]; then
  MIGRATE="no"
fi

# --- Uninstall via openclaw CLI ---
echo "Removing plugin registration..."
if $KEEP_FILES; then
  openclaw plugins uninstall "$PLUGIN_ID" --keep-files --force 2>/dev/null || true
else
  openclaw plugins uninstall "$PLUGIN_ID" --force 2>/dev/null || true
fi

# --- Migrate or remove config ---
if [ "$MIGRATE" = "yes" ]; then
  echo "Migrating channels.whatsapp-pro → channels.whatsapp..."
  node -e "
    const fs = require('fs');
    const configPath = '$CONFIG_PATH';
    if (!fs.existsSync(configPath)) {
      console.log('  No openclaw.json found, skipping.');
      process.exit(0);
    }
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const waProConfig = cfg.channels?.['whatsapp-pro'];
    if (!waProConfig) {
      console.log('  No channels.whatsapp-pro to migrate.');
      process.exit(0);
    }

    // Determine observer-only accounts to exclude
    const observerAccountIds = new Set(
      Array.isArray(waProConfig.observer?.accounts) ? waProConfig.observer.accounts : []
    );

    // Build whatsapp config: copy everything except observer section
    const migrated = { ...waProConfig };
    delete migrated.observer;
    delete migrated.mode;

    // Filter out observer-only accounts
    if (migrated.accounts && observerAccountIds.size > 0) {
      const filtered = {};
      let dropped = 0;
      for (const [id, account] of Object.entries(migrated.accounts)) {
        if (observerAccountIds.has(id)) {
          dropped++;
          continue;
        }
        filtered[id] = account;
      }
      migrated.accounts = filtered;
      if (dropped > 0) {
        console.log('  Dropped ' + dropped + ' observer-only account(s)');
      }
    }

    // Enable the migrated config
    migrated.enabled = true;

    if (!cfg.channels) cfg.channels = {};
    cfg.channels.whatsapp = migrated;
    delete cfg.channels['whatsapp-pro'];

    // Clean up stale plugin entries
    if (cfg.plugins?.entries?.['whatsapp-pro']) {
      delete cfg.plugins.entries['whatsapp-pro'];
    }

    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2) + '\n');
    const accountCount = Object.keys(migrated.accounts || {}).length;
    console.log('  Migrated ' + accountCount + ' account(s) to channels.whatsapp');
    console.log('  Removed channels.whatsapp-pro');
  "
else
  echo "Removing whatsapp-pro config from openclaw.json..."
  node -e "
    const fs = require('fs');
    const configPath = '$CONFIG_PATH';
    if (!fs.existsSync(configPath)) {
      console.log('  No openclaw.json found, skipping.');
      process.exit(0);
    }
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    let changed = false;

    if (cfg.channels?.['whatsapp-pro']) {
      delete cfg.channels['whatsapp-pro'];
      if (Object.keys(cfg.channels).length === 0) delete cfg.channels;
      console.log('  Removed channels.whatsapp-pro');
      changed = true;
    }
    if (cfg.plugins?.entries?.['whatsapp-pro']) {
      delete cfg.plugins.entries['whatsapp-pro'];
      if (Object.keys(cfg.plugins.entries).length === 0) delete cfg.plugins.entries;
      console.log('  Removed plugins.entries.whatsapp-pro');
      changed = true;
    }
    if (cfg.plugins?.entries?.whatsapp?.enabled === false) {
      delete cfg.plugins.entries.whatsapp;
      if (Object.keys(cfg.plugins.entries).length === 0) delete cfg.plugins.entries;
      console.log('  Removed disabled plugins.entries.whatsapp');
      changed = true;
    }

    if (changed) {
      fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2) + '\n');
      console.log('  openclaw.json updated.');
    } else {
      console.log('  No whatsapp-pro config found, skipping.');
    }
  "
fi

# --- Remove leftover extension directory ---
if ! $KEEP_FILES && [ -d "$EXTENSION_DIR" ]; then
  echo "Removing plugin files..."
  rm -rf "$EXTENSION_DIR"
fi

# --- Purge credentials if requested ---
WA_CREDS_DIR="${HOME}/.openclaw/oauth/whatsapp"
if $PURGE_CREDS; then
  if [ -d "$WA_CREDS_DIR" ]; then
    echo "Purging WhatsApp Web credentials ($WA_CREDS_DIR)..."
    rm -rf "$WA_CREDS_DIR"
    echo "  Credentials removed. You will need to re-link your phone after reinstall."
  else
    echo "No credentials found at $WA_CREDS_DIR, skipping."
  fi
fi

# --- Conditionally re-enable built-in whatsapp plugin ---
# Read saved state from the config backup (before we modified it)
WA_WAS_ENABLED=$(node -e "
  const fs = require('fs');
  try {
    const cfg = JSON.parse(fs.readFileSync('$BACKUP_PATH', 'utf8'));
    console.log(cfg.channels?.['whatsapp-pro']?.meta?.previousWhatsappEnabled === true ? 'yes' : 'no');
  } catch { console.log('no'); }
" 2>/dev/null || echo "no")

if [ "$RESTORE_WA" = "yes" ]; then
  echo "Re-enabling built-in whatsapp plugin (--restore-whatsapp)..."
  openclaw plugins enable whatsapp 2>/dev/null || true
elif [ "$RESTORE_WA" = "no" ]; then
  echo "Skipping built-in whatsapp restore (--no-restore-whatsapp)."
elif [ "$WA_WAS_ENABLED" = "yes" ]; then
  echo "Re-enabling built-in whatsapp plugin (was enabled before install)..."
  openclaw plugins enable whatsapp 2>/dev/null || true
else
  echo "Built-in whatsapp was not enabled before install, skipping restore."
fi

echo ""
echo "Uninstalled. You can restart the gateway:"
echo "  openclaw gateway restart"
echo ""
