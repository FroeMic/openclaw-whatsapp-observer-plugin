import type { ObserverConfig } from "./observer/types.js";

const DEFAULT_DB_PATH = "~/.openclaw/whatsapp-observer/messages.db";
const DEFAULT_MEDIA_PATH = "~/.openclaw/whatsapp-observer/media";
const DEFAULT_RETENTION_DAYS = 90;

export function parseObserverConfig(
  pluginConfig: Record<string, unknown> | undefined,
): ObserverConfig {
  const raw = (pluginConfig?.observer ?? {}) as Record<string, unknown>;

  const dbPath = typeof raw.dbPath === "string" ? raw.dbPath : DEFAULT_DB_PATH;
  const mediaPath = typeof raw.mediaPath === "string" ? raw.mediaPath : DEFAULT_MEDIA_PATH;
  const retentionDays =
    typeof raw.retentionDays === "number" ? raw.retentionDays : DEFAULT_RETENTION_DAYS;

  const rawFilters = raw.filters as Record<string, unknown> | undefined;
  const blocklist = Array.isArray(rawFilters?.blocklist)
    ? (rawFilters.blocklist as string[])
    : [];
  const allowlist = Array.isArray(rawFilters?.allowlist)
    ? (rawFilters.allowlist as string[])
    : ["*"];

  return { dbPath, mediaPath, filters: { blocklist, allowlist }, retentionDays };
}

export function isObserverAccount(
  accountId: string,
  config: ObserverConfig,
  accounts?: Map<string, { observerMode?: boolean }>,
): boolean {
  // This is resolved at runtime via the account config's observerMode field.
  // The caller passes in the account map for lookup.
  if (!accounts) return false;
  return accounts.get(accountId)?.observerMode === true;
}
