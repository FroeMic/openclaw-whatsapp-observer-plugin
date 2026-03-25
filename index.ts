import { defineChannelPluginEntry } from "openclaw/plugin-sdk/core";
import { whatsappPlugin, setObserverState } from "./src/channel.js";
import { setWhatsAppRuntime } from "./src/runtime.js";
import { parseObserverConfig, isObserverAccount } from "./src/observer-config.js";
import { ObserverDB, preloadSqlJs } from "./src/observer/db.js";
import { registerObserverTools } from "./src/observer/tools.js";

export { whatsappPlugin } from "./src/channel.js";
export { setWhatsAppRuntime } from "./src/runtime.js";

// Deferred DB holder — tools and hooks reference this; the actual DB
// is created async after WASM loads but tool registration is synchronous.
let observerDb: ObserverDB | null = null;
let dbReady: Promise<ObserverDB> | null = null;

function getObserverDb(): ObserverDB | null {
  return observerDb;
}

async function ensureObserverDb(): Promise<ObserverDB> {
  if (observerDb) return observerDb;
  if (dbReady) return dbReady;
  throw new Error("Observer DB not initialized");
}

export default defineChannelPluginEntry({
  id: "whatsapp-pro",
  name: "WhatsApp Pro",
  description: "WhatsApp channel plugin with observer mode for passive message logging",
  plugin: whatsappPlugin,
  setRuntime: setWhatsAppRuntime,

  registerFull(api) {
    const config = parseObserverConfig(api.pluginConfig);
    const dbPath = api.resolvePath(config.dbPath);
    const mediaPath = api.resolvePath(config.mediaPath);
    const resolvedConfig = { ...config, dbPath, mediaPath };

    // Start async DB creation — tools will await this on first call
    dbReady = ObserverDB.create(dbPath).then((db) => {
      observerDb = db;
      setObserverState(db, resolvedConfig);
      return db;
    });

    // Register tools synchronously with a lazy DB getter.
    // Tool execute() callbacks are async and only run when the agent calls them,
    // by which time the DB will be initialized.
    registerObserverTools(api, () => {
      if (!observerDb) throw new Error("Observer DB not yet initialized");
      return observerDb;
    });

    // Log normal-path messages to the same DB
    api.on("message_received", (event, ctx) => {
      if (!ctx || !observerDb) return;
      const hookCtx = ctx as Record<string, unknown>;
      if (hookCtx.channelId !== "whatsapp") return;
      const hookEvent = event as Record<string, unknown>;
      const metadata = (hookEvent.metadata ?? {}) as Record<string, unknown>;

      try {
        observerDb.insertMessage({
          messageId: (metadata.messageId as string) ?? undefined,
          accountId: (hookCtx.accountId as string) ?? "unknown",
          sender: hookEvent.from as string,
          senderName: (metadata.senderName as string) ?? undefined,
          senderE164: (metadata.senderE164 as string) ?? undefined,
          conversationId: (hookCtx.conversationId as string) ?? (hookEvent.from as string),
          isGroup: Boolean(metadata.isGroup),
          groupName: (metadata.groupSubject as string) ?? undefined,
          content: hookEvent.content as string,
          timestamp: (hookEvent.timestamp as number) ?? Date.now(),
          messageType: "message",
          source: "pipeline",
        });
      } catch (err) {
        api.logger.error(`[whatsapp-pro] Failed to log pipeline message: ${String(err)}`);
      }
    });

    // Safety layer: block outbound on observer accounts
    api.on(
      "message_sending",
      (event, ctx) => {
        if (!ctx) return;
        const hookCtx = ctx as Record<string, unknown>;
        if (hookCtx.channelId !== "whatsapp") return;
        const accountId = hookCtx.accountId as string | undefined;
        if (!accountId) return;

        if (isObserverAccount(accountId, resolvedConfig)) {
          api.logger.warn(
            `[whatsapp-pro] SAFETY: Blocked outbound message on observer account ${accountId}`,
          );
          return { cancel: true };
        }
      },
      { priority: 9999 },
    );

    api.logger.info(
      `[whatsapp-pro] Observer mode initialized (db: ${dbPath}, media: ${mediaPath})`,
    );
  },
});
