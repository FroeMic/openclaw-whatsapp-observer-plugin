import Database from "better-sqlite3";
import type {
  ConversationSummary,
  ObserverMessage,
  ObserverStats,
  StatsGroupByResult,
} from "./types.js";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT,
  account_id TEXT NOT NULL,
  sender TEXT NOT NULL,
  sender_name TEXT,
  sender_e164 TEXT,
  conversation_id TEXT NOT NULL,
  is_group INTEGER NOT NULL DEFAULT 0,
  group_id TEXT,
  group_name TEXT,
  content TEXT,
  media_type TEXT,
  media_path TEXT,
  media_mime TEXT,
  timestamp INTEGER NOT NULL,
  logged_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  UNIQUE(message_id, account_id)
);

CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
CREATE INDEX IF NOT EXISTS idx_messages_group ON messages(group_id);
`;

const FTS_SQL = `
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  content, sender_name, group_name,
  content='messages', content_rowid='id'
);
`;

const FTS_TRIGGERS_SQL = `
CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, content, sender_name, group_name)
  VALUES (new.id, new.content, new.sender_name, new.group_name);
END;

CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content, sender_name, group_name)
  VALUES ('delete', old.id, old.content, old.sender_name, old.group_name);
END;
`;

const INSERT_SQL = `
INSERT OR IGNORE INTO messages (
  message_id, account_id, sender, sender_name, sender_e164,
  conversation_id, is_group, group_id, group_name,
  content, media_type, media_path, media_mime, timestamp
) VALUES (
  @messageId, @accountId, @sender, @senderName, @senderE164,
  @conversationId, @isGroup, @groupId, @groupName,
  @content, @mediaType, @mediaPath, @mediaMime, @timestamp
)`;

export class ObserverDB {
  private db: Database.Database;

  constructor(dbPath: string | ":memory:") {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.init();
  }

  private init(): void {
    this.db.exec(SCHEMA_SQL);
    this.db.exec(FTS_SQL);
    this.db.exec(FTS_TRIGGERS_SQL);
  }

  insertMessage(msg: ObserverMessage): void {
    this.db.prepare(INSERT_SQL).run({
      messageId: msg.messageId ?? null,
      accountId: msg.accountId,
      sender: msg.sender,
      senderName: msg.senderName ?? null,
      senderE164: msg.senderE164 ?? null,
      conversationId: msg.conversationId,
      isGroup: msg.isGroup ? 1 : 0,
      groupId: msg.isGroup ? msg.conversationId : null,
      groupName: msg.groupName ?? null,
      content: msg.content ?? null,
      mediaType: msg.mediaType ?? null,
      mediaPath: msg.mediaPath ?? null,
      mediaMime: msg.mediaMime ?? null,
      timestamp: msg.timestamp,
    });
  }

  search(params: {
    query: string;
    sender?: string;
    group?: string;
    afterDate?: number;
    beforeDate?: number;
    limit?: number;
  }): Array<Record<string, unknown>> {
    const conditions: string[] = [];
    const binds: Record<string, unknown> = {};

    // FTS query — wrap each term in double quotes to escape special FTS5 chars
    conditions.push("m.id IN (SELECT rowid FROM messages_fts WHERE messages_fts MATCH @query)");
    binds.query = params.query
      .split(/\s+/)
      .filter(Boolean)
      .map((term) => `"${term.replace(/"/g, '""')}"`)
      .join(" ");

    if (params.sender) {
      conditions.push("(m.sender = @sender OR m.sender_e164 = @sender OR m.sender_name LIKE @senderLike)");
      binds.sender = params.sender;
      binds.senderLike = `%${params.sender}%`;
    }
    if (params.group) {
      conditions.push("(m.group_id = @group OR m.group_name LIKE @groupLike)");
      binds.group = params.group;
      binds.groupLike = `%${params.group}%`;
    }
    if (params.afterDate) {
      conditions.push("m.timestamp >= @afterDate");
      binds.afterDate = params.afterDate;
    }
    if (params.beforeDate) {
      conditions.push("m.timestamp <= @beforeDate");
      binds.beforeDate = params.beforeDate;
    }

    const limit = Math.min(params.limit ?? 50, 200);
    const sql = `
      SELECT m.id, m.message_id, m.account_id, m.sender, m.sender_name,
             m.sender_e164, m.conversation_id, m.is_group, m.group_id,
             m.group_name, m.content, m.media_type, m.media_path,
             m.timestamp, m.logged_at
      FROM messages m
      WHERE ${conditions.join(" AND ")}
      ORDER BY m.timestamp DESC
      LIMIT @limit
    `;
    binds.limit = limit;

    return this.db.prepare(sql).all(binds) as Array<Record<string, unknown>>;
  }

  getRecent(params: {
    conversationId?: string;
    accountId?: string;
    limit?: number;
  }): Array<Record<string, unknown>> {
    const conditions: string[] = [];
    const binds: Record<string, unknown> = {};

    if (params.conversationId) {
      conditions.push("conversation_id = @conversationId");
      binds.conversationId = params.conversationId;
    }
    if (params.accountId) {
      conditions.push("account_id = @accountId");
      binds.accountId = params.accountId;
    }

    const limit = Math.min(params.limit ?? 50, 200);
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const sql = `
      SELECT id, message_id, account_id, sender, sender_name,
             sender_e164, conversation_id, is_group, group_id,
             group_name, content, media_type, media_path,
             timestamp, logged_at
      FROM messages
      ${where}
      ORDER BY timestamp DESC
      LIMIT @limit
    `;
    binds.limit = limit;

    return this.db.prepare(sql).all(binds) as Array<Record<string, unknown>>;
  }

  listConversations(params: {
    accountId?: string;
    limit?: number;
  }): ConversationSummary[] {
    const conditions: string[] = [];
    const binds: Record<string, unknown> = {};

    if (params.accountId) {
      conditions.push("account_id = @accountId");
      binds.accountId = params.accountId;
    }

    const limit = Math.min(params.limit ?? 50, 200);
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const sql = `
      SELECT
        conversation_id AS conversationId,
        MAX(group_name) AS groupName,
        COUNT(*) AS messageCount,
        MAX(timestamp) AS lastMessageAt,
        (SELECT sender FROM messages m2
         WHERE m2.conversation_id = messages.conversation_id
         ORDER BY m2.timestamp DESC LIMIT 1) AS lastSender
      FROM messages
      ${where}
      GROUP BY conversation_id
      ORDER BY MAX(timestamp) DESC
      LIMIT @limit
    `;
    binds.limit = limit;

    return this.db.prepare(sql).all(binds) as ConversationSummary[];
  }

  getStats(params: {
    accountId?: string;
    afterDate?: number;
    groupBy?: "sender" | "group" | "day" | "hour";
  }): ObserverStats & { grouped?: StatsGroupByResult[] } {
    const conditions: string[] = [];
    const binds: Record<string, unknown> = {};

    if (params.accountId) {
      conditions.push("account_id = @accountId");
      binds.accountId = params.accountId;
    }
    if (params.afterDate) {
      conditions.push("timestamp >= @afterDate");
      binds.afterDate = params.afterDate;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const statsSql = `
      SELECT
        COUNT(*) AS totalMessages,
        COUNT(DISTINCT sender) AS uniqueSenders,
        COUNT(DISTINCT conversation_id) AS uniqueConversations,
        MIN(timestamp) AS firstMessageAt,
        MAX(timestamp) AS lastMessageAt
      FROM messages
      ${where}
    `;

    const stats = this.db.prepare(statsSql).get(binds) as ObserverStats;

    let grouped: StatsGroupByResult[] | undefined;
    if (params.groupBy) {
      let groupExpr: string;
      switch (params.groupBy) {
        case "sender":
          groupExpr = "COALESCE(sender_name, sender)";
          break;
        case "group":
          groupExpr = "COALESCE(group_name, conversation_id)";
          break;
        case "day":
          groupExpr = "date(timestamp / 1000, 'unixepoch')";
          break;
        case "hour":
          groupExpr = "strftime('%H', timestamp / 1000, 'unixepoch')";
          break;
      }

      const groupSql = `
        SELECT ${groupExpr} AS key, COUNT(*) AS count
        FROM messages
        ${where}
        GROUP BY ${groupExpr}
        ORDER BY count DESC
        LIMIT 50
      `;
      grouped = this.db.prepare(groupSql).all(binds) as StatsGroupByResult[];
    }

    return { ...stats, grouped };
  }

  prune(retentionDays: number): number {
    if (retentionDays <= 0) return 0;
    const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const result = this.db.prepare("DELETE FROM messages WHERE timestamp < ?").run(cutoffMs);
    return result.changes;
  }

  close(): void {
    this.db.close();
  }
}
