import { describe, it, expect } from "vitest";
import { isBlocked, isAllowed } from "../src/observer/filter.js";
import type { ObserverFilters } from "../src/observer/types.js";

describe("Filter logic", () => {
  describe("isBlocked", () => {
    it("returns false with empty blocklist", () => {
      const filters: ObserverFilters = { blocklist: [], allowlist: ["*"] };
      expect(isBlocked("+4917612345678", "4917612345678@s.whatsapp.net", filters)).toBe(false);
    });

    it("blocks by sender E.164", () => {
      const filters: ObserverFilters = {
        blocklist: ["+4917612345678"],
        allowlist: ["*"],
      };
      expect(isBlocked("+4917612345678", "4917612345678@s.whatsapp.net", filters)).toBe(true);
    });

    it("blocks by conversationId", () => {
      const filters: ObserverFilters = {
        blocklist: ["spam-group@g.us"],
        allowlist: ["*"],
      };
      expect(isBlocked("+4917600000001", "spam-group@g.us", filters)).toBe(true);
    });

    it("is case-insensitive", () => {
      const filters: ObserverFilters = {
        blocklist: ["+4917612345678"],
        allowlist: ["*"],
      };
      expect(isBlocked("+4917612345678", "other@s.whatsapp.net", filters)).toBe(true);
    });

    it("does not block non-matching entries", () => {
      const filters: ObserverFilters = {
        blocklist: ["+4917600000001"],
        allowlist: ["*"],
      };
      expect(isBlocked("+4917600000002", "other@s.whatsapp.net", filters)).toBe(false);
    });
  });

  describe("isAllowed", () => {
    it("allows everything with wildcard", () => {
      const filters: ObserverFilters = { blocklist: [], allowlist: ["*"] };
      expect(isAllowed("+4917600000001", "any@s.whatsapp.net", filters)).toBe(true);
    });

    it("allows everything with empty allowlist", () => {
      const filters: ObserverFilters = { blocklist: [], allowlist: [] };
      expect(isAllowed("+4917600000001", "any@s.whatsapp.net", filters)).toBe(true);
    });

    it("allows matching sender", () => {
      const filters: ObserverFilters = {
        blocklist: [],
        allowlist: ["+4917600000001"],
      };
      expect(isAllowed("+4917600000001", "4917600000001@s.whatsapp.net", filters)).toBe(true);
    });

    it("allows matching conversationId", () => {
      const filters: ObserverFilters = {
        blocklist: [],
        allowlist: ["family@g.us"],
      };
      expect(isAllowed("+4917600000001", "family@g.us", filters)).toBe(true);
    });

    it("denies non-matching entries with specific allowlist", () => {
      const filters: ObserverFilters = {
        blocklist: [],
        allowlist: ["+4917600000001"],
      };
      expect(isAllowed("+4917600000002", "other@s.whatsapp.net", filters)).toBe(false);
    });
  });

  describe("blocklist takes precedence", () => {
    it("blocks even if sender is on allowlist", () => {
      const filters: ObserverFilters = {
        blocklist: ["+4917600000001"],
        allowlist: ["+4917600000001"],
      };
      // blocklist check happens first in the flow
      expect(isBlocked("+4917600000001", "any@s.whatsapp.net", filters)).toBe(true);
    });

    it("blocks even with wildcard allowlist", () => {
      const filters: ObserverFilters = {
        blocklist: ["+4917600000001"],
        allowlist: ["*"],
      };
      expect(isBlocked("+4917600000001", "any@s.whatsapp.net", filters)).toBe(true);
    });
  });
});
