# WhatsApp Pro — OpenClaw Plugin

A fully independent WhatsApp channel plugin for [OpenClaw](https://openclaw.ai) that passively logs all WhatsApp messages to a queryable SQLite database while running the standard agent pipeline alongside it.

## Features

- **Independent channel** — registers as `whatsapp-pro`, replaces the built-in WhatsApp plugin with identical agent functionality plus observer capabilities
- **Full message capture** — every message (inbound, outbound, agent replies, reactions, edits, deletes) is logged at the Baileys wire level for all accounts
- **Observer-only accounts** — dedicated passive listeners that never send, never trigger agent sessions, and never create conversations
- **`wa-pro` CLI** — standalone oclif CLI for querying messages, managing accounts, and configuring observer settings
- **Agent skill** — automatically teaches the OpenClaw agent about the CLI so it can query message history on demand via `exec`
- **Per-account configuration** — recording mode, allowlist, blocklist, and retention are configurable per account with global defaults
- **Three recording modes** — control what gets stored and what the agent/CLI can retrieve

## Prerequisites

- OpenClaw installed and running (`>=2026.3.22`)
- Node.js 22+
- A WhatsApp account to link (personal or business)

## Quick Start

```bash
# 1. Clone
git clone https://github.com/FroeMic/openclaw-whatsapp-observer-plugin.git
cd openclaw-whatsapp-observer-plugin

# 2. Install (backs up config, disables built-in whatsapp, installs wa-pro CLI)
bash scripts/install.sh

# 3. Setup an account
bash scripts/setup.sh personal        # interactive: choose normal or observer mode
# Scan the QR code with WhatsApp > Linked Devices > Link a Device

# 4. Start
openclaw gateway restart

# 5. Verify
wa-pro stats
wa-pro conversations --format table
```

## Install

```bash
bash scripts/install.sh [--migrate | --no-migrate]
```

| Flag | Description |
|------|-------------|
| `--migrate` | Migrate existing `channels.whatsapp` accounts and policies to `whatsapp-pro` |
| `--no-migrate` | Start fresh — disable built-in whatsapp without copying config |
| *(none)* | Prompted interactively if existing whatsapp config is found |

The install script:
1. Backs up `openclaw.json` (`.pre-whatsapp-pro.bak`)
2. Records whether the built-in whatsapp plugin was previously enabled
3. Disables the built-in whatsapp plugin and cleans up stale config entries
4. Installs the plugin via `openclaw plugins install`
5. Installs root + CLI npm dependencies
6. Links the `wa-pro` binary to `/usr/local/bin`
7. Installs `tsx` globally if not present

Existing config (accounts, policies, observer settings) is preserved across reinstalls.

## Account Setup

```bash
bash scripts/setup.sh <accountId>
```

You'll be prompted to choose:
1. **Normal** — full agent pipeline (receives messages, agent replies, DM policy enforced)
2. **Observer** — passive logging only (no sessions, no replies, no sends)

Both account types log all messages to the observer database. The difference is whether the account participates in the agent pipeline.

You can set up multiple accounts (e.g., a personal phone as observer + a business phone as normal).

## Uninstall

```bash
bash scripts/uninstall.sh [OPTIONS]
```

| Flag | Description |
|------|-------------|
| `--migrate` | Migrate accounts back to `channels.whatsapp` (observer-only accounts excluded) |
| `--no-migrate` | Remove config without migrating back |
| `--restore-whatsapp` | Force re-enable built-in whatsapp plugin |
| `--no-restore-whatsapp` | Don't re-enable built-in whatsapp |
| `--purge-credentials` | Delete WhatsApp Web credentials (`~/.openclaw/credentials/whatsapp/`) |
| `--keep-files` | Keep plugin files on disk |

Without `--restore-whatsapp` / `--no-restore-whatsapp`, the script auto-detects from saved state.

## CLI Reference

### Query Commands

All query commands output JSON by default. Use `--format table` for human-readable output.

```bash
# Full-text search
wa-pro search "<query>" [--sender <name>] [--group <name>] [--after <date>] [--before <date>] [--limit <N>]

# Chronological conversation history (oldest first, max 500)
wa-pro history <conversation-jid> [--account <id>] [--after <date>] [--before <date>] [--limit <N>]

# Recent messages (newest first)
wa-pro recent [--conversation <jid>] [--sender <name>] [--account <id>] [--limit <N>]

# List conversations with message counts and contact names
wa-pro conversations [--account <id>] [--limit <N>]

# Aggregate statistics with optional grouping
wa-pro stats [--account <id>] [--after <date>] [--group-by sender|group|day|hour]
```

### Account Commands

```bash
# List all accounts with role, linked status, policies, and message counts
wa-pro accounts [--format table]
```

### Observer Config Commands

Settings are stored in the observer database and take effect immediately — no gateway restart needed.

All config commands support `--account <id>` for per-account overrides. Without `--account`, they set/show global defaults. Use `--reset --account <id>` to remove an override and fall back to global.

```bash
# View settings (global or per-account)
wa-pro config show [--account <id>]

# Recording/retrieval mode
wa-pro config mode [<mode>] [--account <id>] [--reset]

# Allowlist management
wa-pro config allowlist list|add|remove|clear [<entry>] [--account <id>] [--reset]

# Blocklist management
wa-pro config blocklist list|add|remove|clear [<entry>] [--account <id>] [--reset]

# Retention period (days, 0 = forever)
wa-pro config retention [<days>] [--account <id>] [--reset]
```

## Observer Modes

| Mode | What's Recorded | What's Queryable |
|------|----------------|-----------------|
| `record-all-retrieve-all` *(default)* | All messages | All messages |
| `record-all-retrieve-filtered` | All messages | Only messages matching allowlist/blocklist |
| `record-filtered-retrieve-filtered` | Only allowed messages | Only allowed messages |

Modes are configurable per account with global defaults:

```bash
wa-pro config mode record-all-retrieve-all                          # global default
wa-pro config mode record-all-retrieve-filtered --account michael   # per-account override
wa-pro config mode --reset --account michael                        # remove override
```

These modes are **independent** from the WhatsApp channel's `dmPolicy` / `allowFrom` settings, which control agent session access.

## Configuration

### openclaw.json — Account Config

Account configuration uses the same shape as the native WhatsApp plugin:

```json
{
  "channels": {
    "whatsapp-pro": {
      "accounts": {
        "personal": {
          "enabled": true,
          "dmPolicy": "pairing",
          "groupPolicy": "allowlist",
          "allowFrom": ["+4917600000001"]
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

### Observer Database — Runtime Settings

Observer settings (mode, filters, retention) live in the SQLite database at `~/.openclaw/whatsapp-observer/messages.db`. Manage via `wa-pro config` commands. Settings are scoped:

- **Global defaults** — apply to all accounts unless overridden
- **Per-account overrides** — take precedence over global for that account

On first startup, global defaults are seeded from `openclaw.json` if present. After that, the database is the source of truth.

## Architecture

```
openclaw-whatsapp-observer-plugin/
  index.ts                    # Plugin entry point
  openclaw.plugin.json        # Plugin manifest (channels, skills)
  src/
    channel.ts                # Channel plugin (adapters, gateway, observer tap)
    channel-config.ts         # Zod schema + typed config accessor
    observer-config.ts        # Observer config parsing
    observer/
      monitor.ts              # Baileys listener + message processing (all accounts)
      db.ts                   # SQLite database (messages + scoped settings)
      filter.ts               # Allowlist/blocklist filtering
      types.ts                # Type definitions
    inbound/
      monitor.ts              # Normal account Baileys listener (with observer tap)
    auto-reply/               # Agent pipeline (unchanged from upstream)
  cli/
    bin/run.ts                # CLI entry point (#!/usr/bin/env tsx)
    src/
      commands/               # oclif commands
        search.ts, recent.ts, history.ts, conversations.ts, stats.ts
        accounts.ts
        config/               # show, mode, allowlist, blocklist, retention
      lib/                    # Shared utilities
  skills/
    wa-pro/SKILL.md           # Agent skill definition
  scripts/
    install.sh                # Install with config migration
    uninstall.sh              # Uninstall with config restoration
    setup.sh                  # Account setup (normal/observer)
  test/                       # 63 Vitest tests
```

### Message Flow

**All accounts** (observer and normal) log messages at the Baileys wire level:

```
WhatsApp --> Baileys messages.upsert --> processObserverMessage() --> SQLite DB
```

**Normal accounts** also run the agent pipeline in parallel:

```
WhatsApp --> Baileys --> Observer DB tap --> pipeline --> Agent --> reply
```

**Observer accounts** skip the pipeline entirely:

```
WhatsApp --> Baileys --> Observer DB (+ optional media) --> done
```

### Safety Model

Observer accounts are prevented from sending messages at three layers:

1. **No send wiring** — the observer Baileys socket never calls `sendMessage`
2. **No agent pipeline** — observer messages bypass session creation entirely
3. **`message_sending` hook** — a lifecycle hook blocks any outbound attempt on observer accounts (priority 9999)

## Message Types

| `message_type` | Description | `ref_message_id` |
|---|---|---|
| `message` | Regular text or media message | — |
| `reaction` | Emoji reaction | Original message ID |
| `poll` | Poll creation | — |
| `edit` | Edited message | Original message ID |
| `delete` | Deletion/revoke | Deleted message ID |

## Development

```bash
# Run all tests (63 tests across 4 suites)
npx vitest run

# Test CLI locally
cd cli && npx tsx bin/run.ts --help
cd cli && npx tsx bin/run.ts search "hello" --format table

# Quick deploy to server (without full reinstall)
git pull
cp -r . ~/.openclaw/extensions/whatsapp-pro/
openclaw gateway restart
```

## License

MIT
