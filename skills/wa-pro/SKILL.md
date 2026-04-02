---
name: wa-pro
description: "Search and query passively logged WhatsApp messages via the wa-pro CLI. Use when the user asks about WhatsApp message history, conversation stats, or needs to find specific messages."
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

Query passively logged WhatsApp messages from the observer database using the `wa-pro` CLI.

## When to Use

- User asks about WhatsApp message history or past conversations
- User wants to search for specific messages, topics, or keywords
- User asks to read a specific conversation thread
- User asks for conversation summaries or activity stats
- User wants to know who messaged, when, or how often

Do NOT confuse with normal WhatsApp chat routing — this is for querying the passive observer log.

## Commands

### Search messages

```bash
wa-pro search "<query>" [--sender <name>] [--group <name>] [--after <date>] [--before <date>] [--limit <N>]
```

Full-text keyword search across all logged messages.

### Conversation history

```bash
wa-pro history <conversation-jid> [--account <id>] [--after <date>] [--before <date>] [--limit <N>]
```

Chronological message history for a specific conversation. Use `wa-pro conversations` first to find the JID. Default limit 100, max 500.

### Recent messages

```bash
wa-pro recent [--conversation <jid>] [--sender <name>] [--account <id>] [--limit <N>]
```

Most recent messages (newest first), optionally filtered by conversation, sender, or account.

### List conversations

```bash
wa-pro conversations [--account <id>] [--limit <N>]
```

List conversations ranked by most recent activity, with message counts and contact names.

### Message statistics

```bash
wa-pro stats [--account <id>] [--after <date>] [--group-by sender|group|day|hour]
```

Aggregate stats: total messages, unique senders, unique conversations. Optionally group by sender, group, day, or hour.

## Notes

- Output is JSON by default (use `--format table` for human-readable).
- All outputs include the `account_id` field to distinguish which WhatsApp account received each message.
- Dates use ISO 8601 format (e.g., `2026-03-01`).
- Default limit is 50 for most commands, 100 for history. Max 200 (500 for history).
- JIDs: direct chats look like `<number>@s.whatsapp.net`; groups look like `<id>@g.us` (use `wa-pro conversations` to find them).
- The observer database is written continuously by the WhatsApp Pro plugin — queries reflect real-time data.
