# @openclaw/whatsapp-pro

A forked WhatsApp channel plugin for OpenClaw that adds passive observer-account support alongside the standard WhatsApp integration.

## Overview

This plugin is a full superset of the built-in OpenClaw WhatsApp plugin. Normal and business accounts work identically to upstream -- same runtime methods, same session handling, same agent pipeline. The fork adds two capabilities:

1. **Observer mode** -- designate accounts as passive listeners. Observer accounts connect to WhatsApp via Baileys, log every incoming message (including reactions, polls, edits, and deletions) to a local SQLite database, optionally capture media files, and expose query tools for agents -- all without creating sessions, triggering the agent pipeline, or ever sending a message.

2. **Pipeline logging** -- all messages received on normal (non-observer) accounts are also logged to the same SQLite database via the `message_received` hook. This means agent tools can search across all accounts in one place.

## How It Differs from the Original WhatsApp Plugin

| Capability | Upstream plugin | This fork |
|---|---|---|
| Normal / business accounts | Full support | Identical behaviour (same code paths) |
| Normal-account message logging | Not available | All inbound messages logged to SQLite via hook |
| Observer account mode | Not available | Connect, log, query -- zero send capability |
| Reactions, polls, edits, deletions | Not logged | Logged with message type and reference to original |
| SQLite message store | Not available | Shared DB across all accounts |
| Media capture to disk | Not available | Optional, configurable path |
| Agent query tools | Not available | 4 read-only tools for searching and summarising |

The diff against upstream is intentionally small (~40 lines across `channel.ts` and `index.ts`). All observer logic lives in `src/observer/`, keeping merge conflicts minimal when syncing with upstream changes.

## Architecture

### Three-Layer Safety Model

Observer accounts are prevented from sending messages at three independent layers:

1. **No send methods.** The observer Baileys socket is never wired to any outbound-message function. The code literally does not call `sendMessage`.
2. **No auto-reply pipeline.** Incoming messages on observer accounts skip session creation and agent dispatch entirely. They are routed straight to the SQLite writer.
3. **`message_sending` hook.** As a final guardrail, a lifecycle hook intercepts any outbound message attempt and drops it if the originating account is flagged as an observer.

### Message Flow Comparison

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

Normal accounts log to the DB via a hook (no impact on session/agent flow). Observer accounts bypass the pipeline entirely -- no session is created, no agent is invoked, no reply is sent.

## Getting Started

### Prerequisites

- OpenClaw installed and working
- Node 22 or later
- SQLite 3 CLI (optional, for manual verification)

### Step 1 -- Disable the built-in WhatsApp plugin

```bash
openclaw plugins disable whatsapp
```

### Step 2 -- Install this fork

```bash
openclaw plugins install ~/path-to-this-repo
```

Replace `~/path-to-this-repo` with the actual path to your local clone of this repository.

### Step 3 -- Configure in config.yaml

Add your accounts and plugin settings. Below is a full example showing a normal account (`main`) alongside an observer account (`personal`):

```yaml
channels:
  whatsapp:
    accounts:
      main:
        enabled: true
        dmPolicy: pairing
        allowFrom: ["+4917..."]
      personal:
        enabled: true
        observerMode: true
        # No dmPolicy needed -- observer bypasses access control entirely

plugins:
  entries:
    whatsapp-pro:
      enabled: true
      config:
        observer:
          dbPath: "~/.openclaw/whatsapp-observer/messages.db"
          mediaPath: "~/.openclaw/whatsapp-observer/media"
          filters:
            blocklist: []
            allowlist: ["*"]
          retentionDays: 90
```

### Step 4 -- Login the observer account

```bash
openclaw channels login --account personal
```

Scan the QR code with the WhatsApp app on the phone linked to the observer account.

### Step 5 -- Start the gateway

```bash
openclaw gateway run
```

The observer account will connect, begin receiving messages, and write them to the configured SQLite database.

### Step 6 -- Verify

```bash
sqlite3 ~/.openclaw/whatsapp-observer/messages.db \
  "SELECT source, message_type, sender_name, content, datetime(timestamp/1000, 'unixepoch') FROM messages ORDER BY timestamp DESC LIMIT 10;"
```

You should see rows from both `observer` and `pipeline` sources as messages arrive.

## Message Types

Every logged message has a `message_type` and `source` field:

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

## Observer Config Reference

| Option | Type | Default | Description |
|---|---|---|---|
| `dbPath` | string | `~/.openclaw/whatsapp-observer/messages.db` | Path to the SQLite database file. Created automatically if it does not exist. |
| `mediaPath` | string | `~/.openclaw/whatsapp-observer/media` | Directory for downloaded media files. |
| `filters.blocklist` | string[] | `[]` | E.164 numbers or JIDs to never log. Checked before allowlist. |
| `filters.allowlist` | string[] | `["*"]` | E.164 numbers or JIDs to log. `"*"` means log everything. If non-empty and no wildcard, only matching senders/conversations are logged. |
| `retentionDays` | number | `90` | Messages older than this many days are pruned on startup. Set to `0` to disable pruning. |

## Agent Tools

Observer data is exposed to agents through four read-only tools:

| Tool | Description | Key Parameters |
|---|---|---|
| `wa_observer_search` | Full-text keyword search across stored messages. | `query`, `sender`, `group`, `afterDate`, `beforeDate`, `limit` |
| `wa_observer_recent` | Retrieve the most recent messages, optionally filtered by conversation or account. | `conversationId`, `accountId`, `limit` |
| `wa_observer_conversations` | List all observed conversations with message counts and last-activity timestamps. | `accountId`, `limit` |
| `wa_observer_stats` | Aggregate statistics with optional grouping by sender, group, day, or hour. | `accountId`, `afterDate`, `groupBy` |

## Filter Logic

Filters are evaluated in the following order:

1. **Blocklist first.** If the sender or chat JID matches any pattern in `filters.blocklist`, the message is dropped.
2. **Allowlist second.** If `filters.allowlist` is non-empty, the message is kept only if the JID matches at least one pattern in the list. If the allowlist is empty (the default), all non-blocked messages are kept.

Matching is exact (case-insensitive) against E.164 numbers or JIDs. The special value `"*"` in the allowlist means "allow everything".

## Running Tests

```bash
npx vitest run
```

## Keeping in Sync with Upstream

This fork is designed to minimise divergence. The changes to upstream files are limited to roughly 40 lines across `channel.ts` and `index.ts`, consisting of conditional branches that detect observer-mode accounts and delegate to the observer subsystem. All observer-specific code is isolated in `src/observer/`. When the upstream WhatsApp plugin is updated, pulling in those changes should produce few or no merge conflicts.

## License

MIT -- see [LICENSE](./LICENSE).
