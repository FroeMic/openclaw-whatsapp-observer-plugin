import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ObserverDB } from "../src/observer/db.js";
import { registerObserverTools } from "../src/observer/tools.js";

describe("Observer Tools", () => {
  let db: ObserverDB;
  const registeredTools: Map<string, Record<string, unknown>> = new Map();

  const mockApi = {
    registerTool(toolOrFactory: unknown, opts?: Record<string, unknown>) {
      // Tools are now factory functions (ctx) => toolObject
      const tool = typeof toolOrFactory === "function"
        ? (toolOrFactory as Function)({})
        : toolOrFactory as Record<string, unknown>;
      const name = (opts?.name as string) ?? (tool as Record<string, unknown>).name as string;
      registeredTools.set(name, tool as Record<string, unknown>);
    },
  };

  beforeEach(async () => {
    db = await ObserverDB.create(":memory:");
    registeredTools.clear();
    registerObserverTools(mockApi, db);

    // Seed test data
    await db.insertMessage({
      messageId: "t1",
      accountId: "obs-1",
      sender: "+4917600000001",
      senderName: "Alice",
      conversationId: "group1@g.us",
      isGroup: true,
      groupName: "Team Chat",
      content: "The deployment went smoothly",
      timestamp: new Date("2026-03-20T10:00:00Z").getTime(),
    });
    await db.insertMessage({
      messageId: "t2",
      accountId: "obs-1",
      sender: "+4917600000002",
      senderName: "Bob",
      conversationId: "group1@g.us",
      isGroup: true,
      groupName: "Team Chat",
      content: "Great, any issues with the deployment?",
      timestamp: new Date("2026-03-20T10:05:00Z").getTime(),
    });
    await db.insertMessage({
      messageId: "t3",
      accountId: "obs-1",
      sender: "+4917600000001",
      senderName: "Alice",
      conversationId: "4917600000001@s.whatsapp.net",
      isGroup: false,
      content: "Can we schedule a meeting?",
      timestamp: new Date("2026-03-21T09:00:00Z").getTime(),
    });
  });

  afterEach(() => {
    db.close();
  });

  it("registers all 4 tools", () => {
    expect(registeredTools.size).toBe(4);
    expect(registeredTools.has("wa_observer_search")).toBe(true);
    expect(registeredTools.has("wa_observer_recent")).toBe(true);
    expect(registeredTools.has("wa_observer_conversations")).toBe(true);
    expect(registeredTools.has("wa_observer_stats")).toBe(true);
  });

  describe("wa_observer_search", () => {
    it("searches by keyword", async () => {
      const tool = registeredTools.get("wa_observer_search")!;
      const execute = tool.execute as Function;
      const result = await execute("call-1", { query: "deployment" });
      expect(result.details.count).toBe(2);
    });

    it("returns empty for no matches", async () => {
      const tool = registeredTools.get("wa_observer_search")!;
      const execute = tool.execute as Function;
      const result = await execute("call-2", { query: "nonexistent-xyz" });
      expect(result.details.count).toBe(0);
    });
  });

  describe("wa_observer_recent", () => {
    it("returns recent messages", async () => {
      const tool = registeredTools.get("wa_observer_recent")!;
      const execute = tool.execute as Function;
      const result = await execute("call-3", {});
      expect(result.details.count).toBe(3);
    });

    it("filters by conversationId", async () => {
      const tool = registeredTools.get("wa_observer_recent")!;
      const execute = tool.execute as Function;
      const result = await execute("call-4", {
        conversationId: "group1@g.us",
      });
      expect(result.details.count).toBe(2);
    });
  });

  describe("wa_observer_conversations", () => {
    it("lists all conversations", async () => {
      const tool = registeredTools.get("wa_observer_conversations")!;
      const execute = tool.execute as Function;
      const result = await execute("call-5", {});
      expect(result.details.count).toBe(2);
    });
  });

  describe("wa_observer_stats", () => {
    it("returns aggregate stats", async () => {
      const tool = registeredTools.get("wa_observer_stats")!;
      const execute = tool.execute as Function;
      const result = await execute("call-6", {});
      expect(result.details.totalMessages).toBe(3);
      expect(result.details.uniqueSenders).toBe(2);
    });

    it("supports groupBy", async () => {
      const tool = registeredTools.get("wa_observer_stats")!;
      const execute = tool.execute as Function;
      const result = await execute("call-7", { groupBy: "sender" });
      expect(result.details.grouped).toBeDefined();
      expect(result.details.grouped.length).toBe(2);
    });
  });
});
