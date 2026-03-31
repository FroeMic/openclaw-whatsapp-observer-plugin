import type { WhatsAppProChannelConfig } from "./channel-config.js";
import type { ObserverConfig } from "./observer/types.js";

const DEFAULT_DB_PATH = "~/.openclaw/whatsapp-observer/messages.db";
const DEFAULT_MEDIA_PATH = "~/.openclaw/whatsapp-observer/media";
const DEFAULT_RETENTION_DAYS = 90;

export function parseObserverConfig(
  channelConfig: WhatsAppProChannelConfig | undefined,
): ObserverConfig {
  const raw = channelConfig?.observer;

  const dbPath = typeof raw?.dbPath === "string" ? raw.dbPath : DEFAULT_DB_PATH;
  const mediaPath = typeof raw?.mediaPath === "string" ? raw.mediaPath : DEFAULT_MEDIA_PATH;
  const retentionDays =
    typeof raw?.retentionDays === "number" ? raw.retentionDays : DEFAULT_RETENTION_DAYS;

  const blocklist = Array.isArray(raw?.filters?.blocklist) ? raw.filters.blocklist : [];
  const allowlist = Array.isArray(raw?.filters?.allowlist) ? raw.filters.allowlist : ["*"];

  // Observer account IDs stored in channels.whatsapp-pro.observer.accounts
  const observerAccounts = Array.isArray(raw?.accounts) ? raw.accounts : [];

  return { dbPath, mediaPath, filters: { blocklist, allowlist }, retentionDays, observerAccounts };
}

export function isObserverAccount(accountId: string, config: ObserverConfig): boolean {
  return config.observerAccounts.includes(accountId);
}
