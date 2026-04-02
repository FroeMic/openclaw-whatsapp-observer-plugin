---
name: wa-pro
description: "Search and query passively logged WhatsApp messages via the wa-pro CLI. Use when the user asks about WhatsApp message history, conversation stats, account status, or observer configuration."
metadata:
  {
    "openclaw":
      {
        "emoji": "📊",
        "requires": { "bins": ["wa-pro"] }
      }
  }
---

# wa-pro

Query passively logged WhatsApp messages and manage observer settings using the `wa-pro` CLI.

## When to Use

- User asks about WhatsApp message history or past conversations
- User wants to search for specific messages, topics, or keywords
- User asks to read a specific conversation thread
- User asks for conversation summaries or activity stats
- User wants to know who messaged, when, or how often
- User asks about account status, linked accounts, or observer config
- User wants to change observer mode, filters, or retention settings

Do NOT confuse with normal WhatsApp chat routing — this is for querying the passive observer log.

## Query Commands

### Search messages

```bash
wa-pro search "<query>" [--sender <name>] [--group <name>] [--after <date>] [--before <date>] [--limit <N>]
```

### Conversation history

```bash
wa-pro history <conversation-jid> [--account <id>] [--after <date>] [--before <date>] [--limit <N>]
```

Chronological message history for a specific conversation. Default limit 100, max 500.

### Recent messages

```bash
wa-pro recent [--conversation <jid>] [--sender <name>] [--account <id>] [--limit <N>]
```

### List conversations

```bash
wa-pro conversations [--account <id>] [--limit <N>]
```

### Message statistics

```bash
wa-pro stats [--account <id>] [--after <date>] [--group-by sender|group|day|hour]
```

## Account & Config Commands

### List accounts

```bash
wa-pro accounts [--format json|table]
```

Shows all configured accounts with role (observer/normal), linked status, policies, and message counts.

### View observer settings

```bash
wa-pro config show                        # global defaults
wa-pro config show --account michael      # per-account (with global fallback)
```

### Change observer mode

```bash
wa-pro config mode                                                    # show global
wa-pro config mode record-all-retrieve-all                            # set global
wa-pro config mode record-all-retrieve-filtered --account michael     # set per-account
wa-pro config mode --reset --account michael                          # remove override
```

### Manage allowlist

```bash
wa-pro config allowlist list
wa-pro config allowlist add +4917600000001
wa-pro config allowlist add 120363406173840067@g.us --account michael
wa-pro config allowlist remove +4917600000001
wa-pro config allowlist clear
wa-pro config allowlist --reset --account michael
```

### Manage blocklist

```bash
wa-pro config blocklist list
wa-pro config blocklist add +4917600000001 --account michael
wa-pro config blocklist remove +4917600000001
wa-pro config blocklist clear
wa-pro config blocklist --reset --account michael
```

### Set retention

```bash
wa-pro config retention                           # show global
wa-pro config retention 90                        # set global
wa-pro config retention 30 --account michael      # set per-account
wa-pro config retention --reset --account michael # remove override
```

All config commands support `--account <id>` for per-account overrides. Without `--account`, they operate on global defaults. Per-account settings inherit from global when not explicitly set. Use `--reset --account <id>` to remove an override.

## Notes

- Output is JSON by default for query commands, table for accounts/config. Use `--format` to override.
- All query outputs include the `account_id` field to distinguish WhatsApp accounts.
- Dates use ISO 8601 format (e.g., `2026-03-01`).
- JIDs: direct chats look like `<number>@s.whatsapp.net`; groups look like `<id>@g.us`.
- Config changes (mode, filters, retention) take effect immediately — they're stored in the observer database.
- The observer database is written continuously by the WhatsApp Pro plugin — queries reflect real-time data.
