import { describe, it, expect } from "vitest";
import { parseObserverConfig, isObserverAccount } from "../src/observer-config.js";
import { ObserverDB } from "../src/observer/db.js";

describe("Integration", () => {
  describe("parseObserverConfig", () => {
    it("returns defaults when no plugin config", () => {
      const config = parseObserverConfig(undefined);
      expect(config.dbPath).toBe("~/.openclaw/whatsapp-observer/messages.db");
      expect(config.retentionDays).toBe(90);
      expect(config.mode).toBe("record-all-retrieve-all");
    });

    it("returns defaults when no observer key", () => {
      const config = parseObserverConfig({});
      expect(config.dbPath).toBe("~/.openclaw/whatsapp-observer/messages.db");
      expect(config.filters.allowlist).toEqual(["*"]);
      expect(config.mode).toBe("record-all-retrieve-all");
    });

    it("parses minimal config with defaults", () => {
      const config = parseObserverConfig({
        observer: {},
      });
      expect(config).not.toBeNull();
      expect(config.dbPath).toBe("~/.openclaw/whatsapp-observer/messages.db");
      expect(config.mediaPath).toBe("~/.openclaw/whatsapp-observer/media");
      expect(config.retentionDays).toBe(90);
      expect(config.mode).toBe("record-all-retrieve-all");
      expect(config.filters.blocklist).toEqual([]);
      expect(config.filters.allowlist).toEqual(["*"]);
    });

    it("parses full config", () => {
      const config = parseObserverConfig({
        observer: {
          dbPath: "/custom/db.sqlite",
          mediaPath: "/custom/media",
          retentionDays: 30,
          mode: "record-all-retrieve-filtered",
          filters: {
            blocklist: ["+4917600000001"],
            allowlist: ["+4917600000002", "group@g.us"],
          },
        },
      });
      expect(config).toBeDefined();
      expect(config.dbPath).toBe("/custom/db.sqlite");
      expect(config.mediaPath).toBe("/custom/media");
      expect(config.retentionDays).toBe(30);
      expect(config.mode).toBe("record-all-retrieve-filtered");
      expect(config.filters.blocklist).toEqual(["+4917600000001"]);
      expect(config.filters.allowlist).toEqual(["+4917600000002", "group@g.us"]);
    });

    it("parses all three observer modes", () => {
      const modes = [
        "record-all-retrieve-all",
        "record-all-retrieve-filtered",
        "record-filtered-retrieve-filtered",
      ] as const;

      for (const mode of modes) {
        const config = parseObserverConfig({ observer: { mode } });
        expect(config.mode).toBe(mode);
      }
    });

    it("defaults to record-all-retrieve-all for invalid mode", () => {
      const config = parseObserverConfig({
        observer: { mode: "invalid-mode" },
      });
      expect(config.mode).toBe("record-all-retrieve-all");
    });
  });

  describe("Safety: isObserverAccount", () => {
    it("identifies observer accounts from plugin config", () => {
      const config = parseObserverConfig({
        observer: { accounts: ["observer-1", "personal"] },
      });

      expect(isObserverAccount("observer-1", config)).toBe(true);
      expect(isObserverAccount("personal", config)).toBe(true);
      expect(isObserverAccount("main", config)).toBe(false);
      expect(isObserverAccount("unknown", config)).toBe(false);
    });

    it("returns false when no observer accounts configured", () => {
      const config = parseObserverConfig({});
      expect(isObserverAccount("personal", config)).toBe(false);
    });
  });

  describe("DB direct insert (Baileys-level logging)", () => {
    it("logs a message directly to the DB", async () => {
      const db = await ObserverDB.create(":memory:");

      db.insertMessage({
        messageId: "wa-msg-123",
        accountId: "main",
        sender: "+4917600000001",
        senderName: "Alice",
        senderE164: "+4917600000001",
        conversationId: "4917600000001@s.whatsapp.net",
        isGroup: false,
        content: "Hello from main account",
        timestamp: 1711234567000,
        messageType: "message",
        source: "pipeline",
      });

      const recent = db.getRecent({ limit: 10 });
      expect(recent).toHaveLength(1);
      expect(recent[0].content).toBe("Hello from main account");
      expect(recent[0].source).toBe("pipeline");
      expect(recent[0].message_type).toBe("message");
      expect(recent[0].account_id).toBe("main");

      db.close();
    });
  });
});
