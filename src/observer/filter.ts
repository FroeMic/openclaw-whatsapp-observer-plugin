import type { ObserverFilters } from "./types.js";

/**
 * Blocklist/Allowlist logic:
 * 1. If sender OR conversationId matches blocklist -> SKIP (never log)
 * 2. If allowlist is empty or contains "*" -> LOG
 * 3. If sender OR conversationId matches allowlist -> LOG
 * 4. Otherwise -> SKIP
 *
 * Blocklist always takes precedence.
 */

function matches(value: string | undefined, list: string[]): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return list.some((entry) => {
    if (entry === "*") return true;
    return entry.trim().toLowerCase() === normalized;
  });
}

export function isBlocked(
  sender: string | undefined,
  conversationId: string | undefined,
  filters: ObserverFilters,
): boolean {
  if (filters.blocklist.length === 0) return false;
  return matches(sender, filters.blocklist) || matches(conversationId, filters.blocklist);
}

export function isAllowed(
  sender: string | undefined,
  conversationId: string | undefined,
  filters: ObserverFilters,
): boolean {
  // Empty allowlist or wildcard -> allow everything
  if (filters.allowlist.length === 0 || filters.allowlist.includes("*")) return true;
  return matches(sender, filters.allowlist) || matches(conversationId, filters.allowlist);
}
