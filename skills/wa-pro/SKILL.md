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
- User asks for conversation summaries or activity stats
- User wants to know who messaged, when, or how often

Do NOT confuse with normal WhatsApp chat routing — this is for querying the passive observer log.

## Commands

### Search messages

```bash
wa-pro search "<query>" [--sender <name>] [--group <name>] [--after <date>] [--before <date>] [--limit <N>]
```

Full-text keyword search across all logged messages.

### Recent messages

```bash
wa-pro recent [--conversation <jid>] [--sender <name>] [--account <id>] [--limit <N>]
```

Most recent messages, optionally filtered by conversation, sender, or account.

### List conversations

```bash
wa-pro conversations [--account <id>] [--limit <N>]
```

List conversations ranked by most recent activity, with message counts.

### Message statistics

```bash
wa-pro stats [--account <id>] [--after <date>] [--group-by sender|group|day|hour]
```

Aggregate stats: total messages, unique senders, unique conversations. Optionally group by sender, group, day, or hour.

## Notes

- Output is JSON by default (use `--format table` for human-readable).
- Dates use ISO 8601 format (e.g., `2026-03-01`).
- Default limit is 50, maximum 200.
- JIDs: direct chats look like `<number>@s.whatsapp.net`; groups look like `<id>@g.us`.
- The observer database is written continuously by the WhatsApp Pro plugin — queries reflect real-time data.
