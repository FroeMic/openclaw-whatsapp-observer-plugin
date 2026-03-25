import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ObserverDB } from "../src/observer/db.js";

describe("ObserverDB", () => {
  let db: ObserverDB;

  beforeEach(() => {
    db = new ObserverDB(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  describe("insertMessage", () => {
    it("inserts a direct message", () => {
      db.insertMessage({
        messageId: "msg-1",
        accountId: "observer-1",
        sender: "+4917612345678",
        senderName: "Alice",
        senderE164: "+4917612345678",
        conversationId: "4917612345678@s.whatsapp.net",
        isGroup: false,
        content: "Hello world",
        timestamp: Date.now(),
      });

      const recent = db.getRecent({ limit: 10 });
      expect(recent).toHaveLength(1);
      expect(recent[0].content).toBe("Hello world");
      expect(recent[0].sender).toBe("+4917612345678");
      expect(recent[0].sender_name).toBe("Alice");
    });

    it("inserts a group message", () => {
      db.insertMessage({
        messageId: "msg-2",
        accountId: "observer-1",
        sender: "+4917612345678",
        senderName: "Bob",
        conversationId: "123456789@g.us",
        isGroup: true,
        groupName: "Family Group",
        content: "Hi everyone",
        timestamp: Date.now(),
      });

      const recent = db.getRecent({ limit: 10 });
      expect(recent).toHaveLength(1);
      expect(recent[0].is_group).toBe(1);
      expect(recent[0].group_name).toBe("Family Group");
    });

    it("deduplicates by message_id + account_id", () => {
      const msg = {
        messageId: "msg-dup",
        accountId: "observer-1",
        sender: "+4917612345678",
        conversationId: "4917612345678@s.whatsapp.net",
        isGroup: false,
        content: "Duplicate",
        timestamp: Date.now(),
      };
      db.insertMessage(msg);
      db.insertMessage(msg);

      const recent = db.getRecent({ limit: 10 });
      expect(recent).toHaveLength(1);
    });

    it("inserts media message", () => {
      db.insertMessage({
        messageId: "msg-media",
        accountId: "observer-1",
        sender: "+4917612345678",
        conversationId: "4917612345678@s.whatsapp.net",
        isGroup: false,
        content: "[image]",
        mediaType: "image",
        mediaPath: "/tmp/media/photo.jpg",
        mediaMime: "image/jpeg",
        timestamp: Date.now(),
      });

      const recent = db.getRecent({ limit: 10 });
      expect(recent).toHaveLength(1);
      expect(recent[0].media_type).toBe("image");
      expect(recent[0].media_path).toBe("/tmp/media/photo.jpg");
    });
  });

  describe("search", () => {
    beforeEach(() => {
      db.insertMessage({
        messageId: "s1",
        accountId: "observer-1",
        sender: "+4917600000001",
        senderName: "Alice",
        conversationId: "group1@g.us",
        isGroup: true,
        groupName: "Work Chat",
        content: "Let's discuss the quarterly report",
        timestamp: new Date("2026-03-20").getTime(),
      });
      db.insertMessage({
        messageId: "s2",
        accountId: "observer-1",
        sender: "+4917600000002",
        senderName: "Bob",
        conversationId: "group1@g.us",
        isGroup: true,
        groupName: "Work Chat",
        content: "The report looks good to me",
        timestamp: new Date("2026-03-21").getTime(),
      });
      db.insertMessage({
        messageId: "s3",
        accountId: "observer-1",
        sender: "+4917600000001",
        senderName: "Alice",
        conversationId: "4917600000001@s.whatsapp.net",
        isGroup: false,
        content: "Can you send the meeting notes?",
        timestamp: new Date("2026-03-22").getTime(),
      });
    });

    it("finds messages by keyword", () => {
      const results = db.search({ query: "report" });
      expect(results).toHaveLength(2);
    });

    it("filters by sender", () => {
      const results = db.search({ query: "report", sender: "Alice" });
      expect(results).toHaveLength(1);
      expect(results[0].sender_name).toBe("Alice");
    });

    it("filters by group", () => {
      const results = db.search({ query: "meeting", group: "Work Chat" });
      expect(results).toHaveLength(0);

      const results2 = db.search({ query: "report", group: "Work Chat" });
      expect(results2.length).toBeGreaterThan(0);
    });

    it("filters by date range", () => {
      const results = db.search({
        query: "report",
        afterDate: new Date("2026-03-21").getTime(),
      });
      expect(results).toHaveLength(1);
      expect(results[0].sender_name).toBe("Bob");
    });

    it("respects limit", () => {
      const results = db.search({ query: "report", limit: 1 });
      expect(results).toHaveLength(1);
    });
  });

  describe("getRecent", () => {
    it("returns messages in reverse chronological order", () => {
      db.insertMessage({
        messageId: "r1",
        accountId: "observer-1",
        sender: "+4917600000001",
        conversationId: "c1@s.whatsapp.net",
        isGroup: false,
        content: "First",
        timestamp: 1000,
      });
      db.insertMessage({
        messageId: "r2",
        accountId: "observer-1",
        sender: "+4917600000002",
        conversationId: "c1@s.whatsapp.net",
        isGroup: false,
        content: "Second",
        timestamp: 2000,
      });

      const recent = db.getRecent({ limit: 10 });
      expect(recent).toHaveLength(2);
      expect(recent[0].content).toBe("Second");
      expect(recent[1].content).toBe("First");
    });

    it("filters by conversationId", () => {
      db.insertMessage({
        messageId: "r3",
        accountId: "observer-1",
        sender: "+4917600000001",
        conversationId: "c1@s.whatsapp.net",
        isGroup: false,
        content: "In c1",
        timestamp: 1000,
      });
      db.insertMessage({
        messageId: "r4",
        accountId: "observer-1",
        sender: "+4917600000002",
        conversationId: "c2@s.whatsapp.net",
        isGroup: false,
        content: "In c2",
        timestamp: 2000,
      });

      const recent = db.getRecent({ conversationId: "c1@s.whatsapp.net" });
      expect(recent).toHaveLength(1);
      expect(recent[0].content).toBe("In c1");
    });
  });

  describe("listConversations", () => {
    it("lists conversations with counts", () => {
      db.insertMessage({
        messageId: "lc1",
        accountId: "observer-1",
        sender: "+4917600000001",
        conversationId: "group1@g.us",
        isGroup: true,
        groupName: "Group A",
        content: "msg1",
        timestamp: 1000,
      });
      db.insertMessage({
        messageId: "lc2",
        accountId: "observer-1",
        sender: "+4917600000002",
        conversationId: "group1@g.us",
        isGroup: true,
        groupName: "Group A",
        content: "msg2",
        timestamp: 2000,
      });
      db.insertMessage({
        messageId: "lc3",
        accountId: "observer-1",
        sender: "+4917600000003",
        conversationId: "dm1@s.whatsapp.net",
        isGroup: false,
        content: "msg3",
        timestamp: 3000,
      });

      const convos = db.listConversations({});
      expect(convos).toHaveLength(2);
      expect(convos[0].conversationId).toBe("dm1@s.whatsapp.net");
      expect(convos[0].messageCount).toBe(1);
      expect(convos[1].conversationId).toBe("group1@g.us");
      expect(convos[1].messageCount).toBe(2);
    });
  });

  describe("getStats", () => {
    it("returns aggregate statistics", () => {
      db.insertMessage({
        messageId: "st1",
        accountId: "observer-1",
        sender: "+4917600000001",
        conversationId: "c1@s.whatsapp.net",
        isGroup: false,
        content: "msg1",
        timestamp: 1000,
      });
      db.insertMessage({
        messageId: "st2",
        accountId: "observer-1",
        sender: "+4917600000002",
        conversationId: "c2@s.whatsapp.net",
        isGroup: false,
        content: "msg2",
        timestamp: 2000,
      });

      const stats = db.getStats({});
      expect(stats.totalMessages).toBe(2);
      expect(stats.uniqueSenders).toBe(2);
      expect(stats.uniqueConversations).toBe(2);
    });

    it("supports groupBy sender", () => {
      db.insertMessage({
        messageId: "gs1",
        accountId: "observer-1",
        sender: "+4917600000001",
        senderName: "Alice",
        conversationId: "c1@s.whatsapp.net",
        isGroup: false,
        content: "msg1",
        timestamp: 1000,
      });
      db.insertMessage({
        messageId: "gs2",
        accountId: "observer-1",
        sender: "+4917600000001",
        senderName: "Alice",
        conversationId: "c1@s.whatsapp.net",
        isGroup: false,
        content: "msg2",
        timestamp: 2000,
      });
      db.insertMessage({
        messageId: "gs3",
        accountId: "observer-1",
        sender: "+4917600000002",
        senderName: "Bob",
        conversationId: "c1@s.whatsapp.net",
        isGroup: false,
        content: "msg3",
        timestamp: 3000,
      });

      const stats = db.getStats({ groupBy: "sender" });
      expect(stats.grouped).toBeDefined();
      expect(stats.grouped!.length).toBe(2);
      expect(stats.grouped![0].key).toBe("Alice");
      expect(stats.grouped![0].count).toBe(2);
    });
  });

  describe("prune", () => {
    it("removes messages older than retention period", () => {
      const now = Date.now();
      db.insertMessage({
        messageId: "p1",
        accountId: "observer-1",
        sender: "+4917600000001",
        conversationId: "c1@s.whatsapp.net",
        isGroup: false,
        content: "old",
        timestamp: now - 100 * 24 * 60 * 60 * 1000, // 100 days ago
      });
      db.insertMessage({
        messageId: "p2",
        accountId: "observer-1",
        sender: "+4917600000002",
        conversationId: "c1@s.whatsapp.net",
        isGroup: false,
        content: "recent",
        timestamp: now - 10 * 24 * 60 * 60 * 1000, // 10 days ago
      });

      const pruned = db.prune(90);
      expect(pruned).toBe(1);

      const remaining = db.getRecent({ limit: 10 });
      expect(remaining).toHaveLength(1);
      expect(remaining[0].content).toBe("recent");
    });

    it("does nothing when retentionDays is 0", () => {
      db.insertMessage({
        messageId: "p3",
        accountId: "observer-1",
        sender: "+4917600000001",
        conversationId: "c1@s.whatsapp.net",
        isGroup: false,
        content: "keep forever",
        timestamp: 1000,
      });

      const pruned = db.prune(0);
      expect(pruned).toBe(0);
    });
  });

  describe("message types and sources", () => {
    it("inserts a reaction message", () => {
      db.insertMessage({
        messageId: "react-1",
        accountId: "observer-1",
        sender: "+4917600000001",
        conversationId: "c1@s.whatsapp.net",
        isGroup: false,
        content: "\u{1F44D}",
        messageType: "reaction",
        refMessageId: "original-msg-1",
        source: "observer",
        timestamp: Date.now(),
      });

      const recent = db.getRecent({ limit: 10 });
      expect(recent).toHaveLength(1);
      expect(recent[0].message_type).toBe("reaction");
      expect(recent[0].ref_message_id).toBe("original-msg-1");
      expect(recent[0].source).toBe("observer");
      expect(recent[0].content).toBe("\u{1F44D}");
    });

    it("inserts a pipeline message", () => {
      db.insertMessage({
        messageId: "pipe-1",
        accountId: "main",
        sender: "+4917600000002",
        conversationId: "c2@s.whatsapp.net",
        isGroup: false,
        content: "Hello from pipeline",
        messageType: "message",
        source: "pipeline",
        timestamp: Date.now(),
      });

      const recent = db.getRecent({ limit: 10 });
      expect(recent).toHaveLength(1);
      expect(recent[0].source).toBe("pipeline");
      expect(recent[0].message_type).toBe("message");
    });

    it("inserts a poll message", () => {
      db.insertMessage({
        messageId: "poll-1",
        accountId: "observer-1",
        sender: "+4917600000001",
        conversationId: "group1@g.us",
        isGroup: true,
        content: "[poll] Lunch spot: Pizza, Sushi, Burgers",
        messageType: "poll",
        source: "observer",
        timestamp: Date.now(),
      });

      const recent = db.getRecent({ limit: 10 });
      expect(recent).toHaveLength(1);
      expect(recent[0].message_type).toBe("poll");
    });

    it("inserts an edit message", () => {
      db.insertMessage({
        messageId: "edit-1",
        accountId: "observer-1",
        sender: "+4917600000001",
        conversationId: "c1@s.whatsapp.net",
        isGroup: false,
        content: "Corrected text",
        messageType: "edit",
        refMessageId: "original-msg-2",
        source: "observer",
        timestamp: Date.now(),
      });

      const recent = db.getRecent({ limit: 10 });
      expect(recent).toHaveLength(1);
      expect(recent[0].message_type).toBe("edit");
      expect(recent[0].ref_message_id).toBe("original-msg-2");
    });

    it("inserts a delete message", () => {
      db.insertMessage({
        messageId: "del-1",
        accountId: "observer-1",
        sender: "+4917600000001",
        conversationId: "c1@s.whatsapp.net",
        isGroup: false,
        content: "[message deleted]",
        messageType: "delete",
        refMessageId: "original-msg-3",
        source: "observer",
        timestamp: Date.now(),
      });

      const recent = db.getRecent({ limit: 10 });
      expect(recent).toHaveLength(1);
      expect(recent[0].message_type).toBe("delete");
    });

    it("defaults to message type and observer source", () => {
      db.insertMessage({
        messageId: "default-1",
        accountId: "observer-1",
        sender: "+4917600000001",
        conversationId: "c1@s.whatsapp.net",
        isGroup: false,
        content: "Normal message",
        timestamp: Date.now(),
      });

      const recent = db.getRecent({ limit: 10 });
      expect(recent).toHaveLength(1);
      expect(recent[0].message_type).toBe("message");
      expect(recent[0].source).toBe("observer");
      expect(recent[0].ref_message_id).toBeNull();
    });

    it("search returns new columns", () => {
      db.insertMessage({
        messageId: "search-mt-1",
        accountId: "observer-1",
        sender: "+4917600000001",
        senderName: "Alice",
        conversationId: "c1@s.whatsapp.net",
        isGroup: false,
        content: "searchable reaction text",
        messageType: "reaction",
        source: "pipeline",
        timestamp: Date.now(),
      });

      const results = db.search({ query: "searchable" });
      expect(results).toHaveLength(1);
      expect(results[0].message_type).toBe("reaction");
      expect(results[0].source).toBe("pipeline");
    });
  });
});
