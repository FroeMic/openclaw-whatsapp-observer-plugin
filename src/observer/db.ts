import initSqlJs, { type Database } from "sql.js";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
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
  message_type TEXT NOT NULL DEFAULT 'message',
  ref_message_id TEXT,
  source TEXT NOT NULL DEFAULT 'observer',
  timestamp INTEGER NOT NULL,
  logged_at INTEGER NOT NULL DEFAULT 0,
  UNIQUE(message_id, account_id)
);

CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
CREATE INDEX IF NOT EXISTS idx_messages_group ON messages(group_id);
CREATE INDEX IF NOT EXISTS idx_messages_content ON messages(content);
`;

const MIGRATION_COLUMNS = [
  "ALTER TABLE messages ADD COLUMN message_type TEXT NOT NULL DEFAULT 'message';",
  "ALTER TABLE messages ADD COLUMN ref_message_id TEXT;",
  "ALTER TABLE messages ADD COLUMN source TEXT NOT NULL DEFAULT 'observer';",
];

const INSERT_SQL = `
INSERT OR IGNORE INTO messages (
  message_id, account_id, sender, sender_name, sender_e164,
  conversation_id, is_group, group_id, group_name,
  content, media_type, media_path, media_mime, timestamp,
  message_type, ref_message_id, source, logged_at
) VALUES (
  :messageId, :accountId, :sender, :senderName, :senderE164,
  :conversationId, :isGroup, :groupId, :groupName,
  :content, :mediaType, :mediaPath, :mediaMime, :timestamp,
  :messageType, :refMessageId, :source, :loggedAt
)`;

// Pre-load WASM — must be awaited before creating ObserverDB
let sqlJsPromise: ReturnType<typeof initSqlJs> | null = null;
export function preloadSqlJs(): ReturnType<typeof initSqlJs> {
  if (!sqlJsPromise) {
    sqlJsPromise = initSqlJs();
  }
  return sqlJsPromise;
}
// Start loading immediately on import
preloadSqlJs();

export class ObserverDB {
  private db: Database;
  private dbPath: string | null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Create an ObserverDB. Call `await preloadSqlJs()` first to ensure
   * the WASM module is ready, then this constructor is synchronous.
   */
  constructor(db: Database, dbPath: string | null) {
    this.db = db;
    this.dbPath = dbPath;
    this.init();
  }

  static async create(dbPath: string | ":memory:"): Promise<ObserverDB> {
    const SQL = await preloadSqlJs();
    let db: Database;
    if (dbPath === ":memory:") {
      db = new SQL.Database();
      return new ObserverDB(db, null);
    }
    try {
      const buffer = readFileSync(dbPath);
      db = new SQL.Database(buffer);
    } catch {
      mkdirSync(dirname(dbPath), { recursive: true });
      db = new SQL.Database();
    }
    return new ObserverDB(db, dbPath);
  }

  private init(): void {
    this.db.run("PRAGMA journal_mode = WAL;");
    this.db.run("PRAGMA foreign_keys = ON;");
    this.db.exec(SCHEMA_SQL);
    for (const stmt of MIGRATION_COLUMNS) {
      try {
        this.db.run(stmt);
      } catch {
        // Column already exists
      }
    }
  }

  private scheduleSave(): void {
    if (!this.dbPath || this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flush();
    }, 1000);
  }

  flush(): void {
    if (!this.dbPath) return;
    try {
      const data = this.db.export();
      writeFileSync(this.dbPath, Buffer.from(data));
    } catch {
      // best-effort
    }
  }

  insertMessage(msg: ObserverMessage): void {
    this.db.run(INSERT_SQL, {
      ":messageId": msg.messageId ?? null,
      ":accountId": msg.accountId,
      ":sender": msg.sender,
      ":senderName": msg.senderName ?? null,
      ":senderE164": msg.senderE164 ?? null,
      ":conversationId": msg.conversationId,
      ":isGroup": msg.isGroup ? 1 : 0,
      ":groupId": msg.isGroup ? msg.conversationId : null,
      ":groupName": msg.groupName ?? null,
      ":content": msg.content ?? null,
      ":mediaType": msg.mediaType ?? null,
      ":mediaPath": msg.mediaPath ?? null,
      ":mediaMime": msg.mediaMime ?? null,
      ":timestamp": msg.timestamp,
      ":messageType": msg.messageType ?? "message",
      ":refMessageId": msg.refMessageId ?? null,
      ":source": msg.source ?? "observer",
      ":loggedAt": Date.now(),
    });
    this.scheduleSave();
  }

  private query(sql: string, binds: Record<string, unknown> = {}): Array<Record<string, unknown>> {
    const stmt = this.db.prepare(sql);
    stmt.bind(binds);
    const results: Array<Record<string, unknown>> = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject() as Record<string, unknown>);
    }
    stmt.free();
    return results;
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

    const terms = params.query.split(/\s+/).filter(Boolean);
    for (let i = 0; i < terms.length; i++) {
      conditions.push(`(m.content LIKE :term${i} OR m.sender_name LIKE :term${i} OR m.group_name LIKE :term${i})`);
      binds[`:term${i}`] = `%${terms[i]}%`;
    }

    if (params.sender) {
      conditions.push("(m.sender = :sender OR m.sender_e164 = :sender OR m.sender_name LIKE :senderLike)");
      binds[":sender"] = params.sender;
      binds[":senderLike"] = `%${params.sender}%`;
    }
    if (params.group) {
      conditions.push("(m.group_id = :group OR m.group_name LIKE :groupLike)");
      binds[":group"] = params.group;
      binds[":groupLike"] = `%${params.group}%`;
    }
    if (params.afterDate) {
      conditions.push("m.timestamp >= :afterDate");
      binds[":afterDate"] = params.afterDate;
    }
    if (params.beforeDate) {
      conditions.push("m.timestamp <= :beforeDate");
      binds[":beforeDate"] = params.beforeDate;
    }

    if (conditions.length === 0) {
      conditions.push("1=1");
    }

    const limit = Math.min(params.limit ?? 50, 200);
    const sql = `
      SELECT m.id, m.message_id, m.account_id, m.sender, m.sender_name,
             m.sender_e164, m.conversation_id, m.is_group, m.group_id,
             m.group_name, m.content, m.media_type, m.media_path,
             m.timestamp, m.logged_at, m.message_type, m.ref_message_id, m.source
      FROM messages m
      WHERE ${conditions.join(" AND ")}
      ORDER BY m.timestamp DESC
      LIMIT :limit
    `;
    binds[":limit"] = limit;

    return this.query(sql, binds);
  }

  getRecent(params: {
    conversationId?: string;
    sender?: string;
    accountId?: string;
    limit?: number;
  }): Array<Record<string, unknown>> {
    const conditions: string[] = [];
    const binds: Record<string, unknown> = {};

    if (params.conversationId) {
      conditions.push("conversation_id = :conversationId");
      binds[":conversationId"] = params.conversationId;
    }
    if (params.sender) {
      conditions.push("(sender = :sender OR sender_e164 = :sender OR sender_name LIKE :senderLike)");
      binds[":sender"] = params.sender;
      binds[":senderLike"] = `%${params.sender}%`;
    }
    if (params.accountId) {
      conditions.push("account_id = :accountId");
      binds[":accountId"] = params.accountId;
    }

    const limit = Math.min(params.limit ?? 50, 200);
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const sql = `
      SELECT id, message_id, account_id, sender, sender_name,
             sender_e164, conversation_id, is_group, group_id,
             group_name, content, media_type, media_path,
             timestamp, logged_at, message_type, ref_message_id, source
      FROM messages
      ${where}
      ORDER BY timestamp DESC
      LIMIT :limit
    `;
    binds[":limit"] = limit;

    return this.query(sql, binds);
  }

  listConversations(params: {
    accountId?: string;
    limit?: number;
  }): ConversationSummary[] {
    const conditions: string[] = [];
    const binds: Record<string, unknown> = {};

    if (params.accountId) {
      conditions.push("account_id = :accountId");
      binds[":accountId"] = params.accountId;
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
      LIMIT :limit
    `;
    binds[":limit"] = limit;

    return this.query(sql, binds) as unknown as ConversationSummary[];
  }

  getStats(params: {
    accountId?: string;
    afterDate?: number;
    groupBy?: "sender" | "group" | "day" | "hour";
  }): ObserverStats & { grouped?: StatsGroupByResult[] } {
    const conditions: string[] = [];
    const binds: Record<string, unknown> = {};

    if (params.accountId) {
      conditions.push("account_id = :accountId");
      binds[":accountId"] = params.accountId;
    }
    if (params.afterDate) {
      conditions.push("timestamp >= :afterDate");
      binds[":afterDate"] = params.afterDate;
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

    const statsRows = this.query(statsSql, binds);
    const stats = (statsRows[0] ?? {
      totalMessages: 0,
      uniqueSenders: 0,
      uniqueConversations: 0,
      firstMessageAt: null,
      lastMessageAt: null,
    }) as ObserverStats;

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
      grouped = this.query(groupSql, binds) as unknown as StatsGroupByResult[];
    }

    return { ...stats, grouped };
  }

  prune(retentionDays: number): number {
    if (retentionDays <= 0) return 0;
    const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    this.db.run("DELETE FROM messages WHERE timestamp < :cutoff", { ":cutoff": cutoffMs });
    const result = this.query("SELECT changes() AS count");
    this.scheduleSave();
    return (result[0]?.count as number) ?? 0;
  }

  close(): void {
    this.flush();
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.db.close();
  }
}
