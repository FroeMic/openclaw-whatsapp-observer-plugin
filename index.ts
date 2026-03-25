import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { whatsappPlugin, setObserverState } from "./src/channel.js";
import { setWhatsAppRuntime } from "./src/runtime.js";
import { parseObserverConfig, isObserverAccount } from "./src/observer-config.js";
import { ObserverDB, preloadSqlJs } from "./src/observer/db.js";
import { registerObserverTools } from "./src/observer/tools.js";

export { whatsappPlugin } from "./src/channel.js";
export { setWhatsAppRuntime } from "./src/runtime.js";

let observerDb: ObserverDB | null = null;

export default definePluginEntry({
  id: "whatsapp-pro",
  name: "WhatsApp Pro",
  description: "WhatsApp channel plugin with observer mode for passive message logging",

  register(api) {
    // Set up runtime and register channel (same as defineChannelPluginEntry)
    setWhatsAppRuntime(api.runtime);
    api.registerChannel({ plugin: whatsappPlugin });

    // Observer setup — DB init + tool registration + hooks
    const config = parseObserverConfig(api.pluginConfig);
    const dbPath = api.resolvePath(config.dbPath);
    const mediaPath = api.resolvePath(config.mediaPath);
    const resolvedConfig = { ...config, dbPath, mediaPath };

    // Start async DB creation — tools use a lazy getter
    ObserverDB.create(dbPath).then((db) => {
      observerDb = db;
      setObserverState(db, resolvedConfig);
    });

    // Register tools synchronously with lazy DB getter
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
