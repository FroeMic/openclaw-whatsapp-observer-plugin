import { describe, it, expect, vi } from "vitest";
import { parseObserverConfig } from "../src/observer-config.js";
import { ObserverDB } from "../src/observer/db.js";
import { registerObserverTools } from "../src/observer/tools.js";

describe("Integration", () => {
  describe("parseObserverConfig", () => {
    it("returns null when no plugin config", () => {
      expect(parseObserverConfig(undefined)).toBeNull();
    });

    it("returns null when no observer key", () => {
      expect(parseObserverConfig({})).toBeNull();
    });

    it("parses minimal config with defaults", () => {
      const config = parseObserverConfig({
        observer: {},
      });
      expect(config).not.toBeNull();
      expect(config!.dbPath).toBe("~/.openclaw/whatsapp-observer/messages.db");
      expect(config!.mediaPath).toBe("~/.openclaw/whatsapp-observer/media");
      expect(config!.retentionDays).toBe(90);
      expect(config!.filters.blocklist).toEqual([]);
      expect(config!.filters.allowlist).toEqual(["*"]);
    });

    it("parses full config", () => {
      const config = parseObserverConfig({
        observer: {
          dbPath: "/custom/db.sqlite",
          mediaPath: "/custom/media",
          retentionDays: 30,
          filters: {
            blocklist: ["+4917600000001"],
            allowlist: ["+4917600000002", "group@g.us"],
          },
        },
      });
      expect(config).not.toBeNull();
      expect(config!.dbPath).toBe("/custom/db.sqlite");
      expect(config!.mediaPath).toBe("/custom/media");
      expect(config!.retentionDays).toBe(30);
      expect(config!.filters.blocklist).toEqual(["+4917600000001"]);
      expect(config!.filters.allowlist).toEqual(["+4917600000002", "group@g.us"]);
    });
  });

  describe("Plugin registration flow", () => {
    it("registers tools when observer config is present", () => {
      const db = new ObserverDB(":memory:");
      const tools: string[] = [];
      const mockApi = {
        registerTool(tool: Record<string, unknown>, opts?: { name: string }) {
          tools.push(opts?.name ?? (tool.name as string));
        },
      };

      registerObserverTools(mockApi, db);

      expect(tools).toEqual([
        "wa_observer_search",
        "wa_observer_recent",
        "wa_observer_conversations",
        "wa_observer_stats",
      ]);

      db.close();
    });
  });

  describe("Safety: message_sending hook", () => {
    it("blocks outbound on observer accounts", () => {
      // Simulate the hook logic from index.ts
      const blocked: string[] = [];

      function messageSendingHook(
        _event: unknown,
        ctx: Record<string, unknown>,
      ): { cancel: true } | undefined {
        if (ctx.channelId !== "whatsapp") return;
        const accountId = ctx.accountId as string | undefined;
        if (!accountId) return;

        const waAccounts = (
          (ctx.config as Record<string, unknown>)?.channels as Record<string, unknown>
        )?.whatsapp as Record<string, unknown>;
        const accounts = waAccounts?.accounts as Record<string, Record<string, unknown>>;
        const accountConfig = accounts?.[accountId];

        if (accountConfig?.observerMode) {
          blocked.push(accountId);
          return { cancel: true };
        }
      }

      // Test observer account
      const result1 = messageSendingHook(
        { to: "+4917600000001", content: "Hello" },
        {
          channelId: "whatsapp",
          accountId: "observer-1",
          config: {
            channels: {
              whatsapp: {
                accounts: {
                  "observer-1": { observerMode: true },
                  main: { observerMode: false },
                },
              },
            },
          },
        },
      );
      expect(result1).toEqual({ cancel: true });
      expect(blocked).toEqual(["observer-1"]);

      // Test normal account
      const result2 = messageSendingHook(
        { to: "+4917600000001", content: "Hello" },
        {
          channelId: "whatsapp",
          accountId: "main",
          config: {
            channels: {
              whatsapp: {
                accounts: {
                  "observer-1": { observerMode: true },
                  main: { observerMode: false },
                },
              },
            },
          },
        },
      );
      expect(result2).toBeUndefined();
    });
  });
});
