# WhatsApp Pro — OpenClaw Plugin

An independent WhatsApp channel plugin for [OpenClaw](https://openclaw.ai) with passive message observation, a standalone CLI for querying message history, and configurable recording/retrieval modes.

## Features

- **Independent channel** — registers as `whatsapp-pro`, can coexist with the built-in WhatsApp plugin
- **Observer mode** — passively log all WhatsApp messages to a local SQLite database without triggering agent sessions
- **Normal mode** — full agent pipeline with DM policy, group policy, and access control (same as built-in)
- **`wa-pro` CLI** — query message history, manage observer settings, inspect accounts
- **Agent skill** — teaches the OpenClaw agent about `wa-pro` so it can query message history on demand
- **Three recording modes** — control what gets stored and what the agent can see

## Install

```bash
git clone https://github.com/FroeMic/openclaw-whatsapp-observer-plugin.git
cd openclaw-whatsapp-observer-plugin
bash scripts/install.sh
```

The install script will:
1. Back up your `openclaw.json`
2. Optionally migrate existing `channels.whatsapp` config to `whatsapp-pro`
3. Install the plugin and link the `wa-pro` CLI
4. Install `tsx` if needed (required for the CLI)

### Install flags

| Flag | Description |
|------|-------------|
| `--migrate` | Migrate existing `channels.whatsapp` config to `whatsapp-pro` |
| `--no-migrate` | Start fresh, disable built-in whatsapp without copying config |

If neither flag is given and `channels.whatsapp` config exists, you will be prompted.

## Setup

```bash
bash scripts/setup.sh <accountId>
```

You'll be prompted to choose between **normal** (full agent pipeline) and **observer** (passive logging only) mode for the account. Then scan the QR code to link your phone.

```bash
openclaw gateway restart
```

## Uninstall

```bash
bash scripts/uninstall.sh
```

### Uninstall flags

| Flag | Description |
|------|-------------|
| `--migrate` | Migrate config back to `channels.whatsapp` (observer-only accounts are excluded) |
| `--no-migrate` | Remove `channels.whatsapp-pro` config without migrating back |
| `--restore-whatsapp` | Re-enable built-in whatsapp plugin |
| `--no-restore-whatsapp` | Don't re-enable built-in whatsapp |
| `--purge-credentials` | Delete WhatsApp Web session credentials (`~/.openclaw/oauth/whatsapp/`) |
| `--keep-files` | Keep plugin files on disk |

If `--restore-whatsapp` / `--no-restore-whatsapp` is not given, the script auto-detects whether whatsapp was enabled before install.

## CLI Reference

### Query Commands

```bash
# Full-text search
wa-pro search "<query>" [--sender <name>] [--group <name>] [--after <date>] [--before <date>] [--limit <N>]

# Chronological conversation history
wa-pro history <conversation-jid> [--account <id>] [--after <date>] [--before <date>] [--limit <N>]

# Recent messages (newest first)
wa-pro recent [--conversation <jid>] [--sender <name>] [--account <id>] [--limit <N>]

# List conversations with message counts
wa-pro conversations [--account <id>] [--limit <N>]

# Message statistics
wa-pro stats [--account <id>] [--after <date>] [--group-by sender|group|day|hour]
```

All query commands output JSON by default. Use `--format table` for human-readable output. All outputs include `account_id` to distinguish messages from different WhatsApp accounts.

### Account & Config Commands

```bash
# List accounts with status, policies, and message counts
wa-pro accounts [--format table]

# View observer settings (from DB)
wa-pro config show

# Change recording/retrieval mode
wa-pro config mode record-all-retrieve-all
wa-pro config mode record-all-retrieve-filtered
wa-pro config mode record-filtered-retrieve-filtered

# Manage allowlist
wa-pro config allowlist list
wa-pro config allowlist add +4917600000001
wa-pro config allowlist add 120363406173840067@g.us
wa-pro config allowlist remove +4917600000001
wa-pro config allowlist clear

# Manage blocklist
wa-pro config blocklist list
wa-pro config blocklist add +4917600000001
wa-pro config blocklist remove +4917600000001
wa-pro config blocklist clear

# Set message retention
wa-pro config retention 90    # 90 days
wa-pro config retention 0     # Keep forever
```

Config changes take effect immediately — they're stored in the observer database, not `openclaw.json`.

## Observer Modes

| Mode | Recording | Retrieval |
|------|-----------|-----------|
| `record-all-retrieve-all` (default) | All messages | All messages |
| `record-all-retrieve-filtered` | All messages | Filtered by allowlist/blocklist |
| `record-filtered-retrieve-filtered` | Only allowed | Only allowed (naturally) |

These modes are **independent** from the WhatsApp channel's `dmPolicy` / `allowFrom` settings, which control which messages trigger agent sessions.

## Configuration

### openclaw.json

Account configuration lives in `channels.whatsapp-pro` — same shape as the native WhatsApp plugin:

```json
{
  "channels": {
    "whatsapp-pro": {
      "accounts": {
        "personal": {
          "enabled": true,
          "dmPolicy": "pairing",
          "groupPolicy": "allowlist"
        },
        "michael": {
          "enabled": true
        }
      },
      "observer": {
        "accounts": ["michael"]
      }
    }
  }
}
```

### Observer Database

Observer settings (mode, filters, retention) are stored in the SQLite database at `~/.openclaw/whatsapp-observer/messages.db`. Manage them with `wa-pro config` commands. On first plugin startup, settings are seeded from `openclaw.json` (one-time migration); after that, the DB is the source of truth.

## Architecture

```
openclaw-whatsapp-observer-plugin/
  index.ts                    # Plugin entry point
  openclaw.plugin.json        # Plugin manifest (channels, skills)
  src/
    channel.ts                # Channel plugin (adapters, gateway, etc.)
    channel-config.ts         # Zod schema + typed config accessor
    observer-config.ts        # Observer config parsing
    observer/
      monitor.ts              # Passive Baileys listener for observer accounts
      db.ts                   # SQLite database (messages + settings tables)
      filter.ts               # Allowlist/blocklist filtering
      types.ts                # Type definitions
  cli/
    bin/run.ts                # CLI entry point (#!/usr/bin/env tsx)
    src/
      commands/               # oclif commands (search, recent, history, etc.)
      lib/                    # Shared CLI utilities (db-reader, config-reader, etc.)
  skills/
    wa-pro/SKILL.md           # Agent skill (teaches the agent about wa-pro CLI)
  scripts/
    install.sh                # Install plugin + CLI with config migration
    uninstall.sh              # Remove plugin + CLI with config restoration
    setup.sh                  # Setup an account (normal or observer)
  test/                       # Vitest tests
```

### Three-Layer Safety Model

Observer accounts are prevented from sending messages at three independent layers:

1. **No send methods.** The observer Baileys socket is never wired to any outbound-message function.
2. **No auto-reply pipeline.** Incoming messages on observer accounts skip session creation and agent dispatch entirely.
3. **`message_sending` hook.** A lifecycle hook intercepts any outbound message attempt and drops it if the originating account is flagged as an observer.

### Message Flow

**Normal account:**
```
WhatsApp --> Baileys --> channel.onMessage --> OpenClaw session --> Agent --> reply
                                                  |
                                          message_received hook --> SQLite write
```

**Observer account:**
```
WhatsApp --> Baileys --> observer.onMessage --> SQLite write (+ optional media save) --> done
```

## Message Types

| `message_type` | Description | `ref_message_id` |
|---|---|---|
| `message` | Regular text or media message | -- |
| `reaction` | Emoji reaction | ID of the message being reacted to |
| `poll` | Poll creation (question + options) | -- |
| `edit` | Edited message (new content) | ID of the original message |
| `delete` | Message deletion / revoke | ID of the deleted message |

| `source` | Description |
|---|---|
| `observer` | Captured by the observer Baileys listener |
| `pipeline` | Captured from a normal account via `message_received` hook |

## Development

```bash
# Run tests
npx vitest run

# Test CLI locally
cd cli && npx tsx bin/run.ts --help

# Test a specific CLI command
cd cli && npx tsx bin/run.ts search "hello" --format table
```

## License

MIT
