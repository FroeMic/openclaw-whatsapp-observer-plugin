import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { whatsappPlugin, setObserverState } from "./src/channel.js";
import { setWhatsAppRuntime } from "./src/runtime.js";
import { getChannelConfig } from "./src/channel-config.js";
import { parseObserverConfig, isObserverAccount } from "./src/observer-config.js";
import { ObserverDB, preloadSqlJs } from "./src/observer/db.js";

export { whatsappPlugin } from "./src/channel.js";
export { setWhatsAppRuntime } from "./src/runtime.js";

let observerDb: ObserverDB | null = null;
let registerCallCount = 0;
let dbInstanceId = 0;

export default definePluginEntry({
  id: "whatsapp-pro",
  name: "WhatsApp Pro",
  description: "WhatsApp channel plugin with observer mode for passive message logging",

  register(api) {
    registerCallCount++;
    const thisRegisterCall = registerCallCount;
    api.logger.warn(`[whatsapp-pro] register() called (call #${thisRegisterCall})`);

    // Set up runtime and register channel (same as defineChannelPluginEntry)
    setWhatsAppRuntime(api.runtime);
    api.registerChannel({ plugin: whatsappPlugin });

    // Observer setup — DB init + hooks (CLI provides query interface via wa-pro skill)
    const config = parseObserverConfig(getChannelConfig(api.config));
    const dbPath = api.resolvePath(config.dbPath);
    const mediaPath = api.resolvePath(config.mediaPath);
    const resolvedConfig = { ...config, dbPath, mediaPath };

    // Start async DB creation + seed settings from config if needed
    ObserverDB.create(dbPath).then((db) => {
      dbInstanceId++;
      const thisDbId = dbInstanceId;
      const prevDb = observerDb;
      observerDb = db;

      api.logger.warn(`[whatsapp-pro] DB instance #${thisDbId} created (register call #${thisRegisterCall}, replaced instance: ${prevDb ? 'yes' : 'no'})`);

      // Seed DB settings from openclaw.json on first run (migration)
      db.seedSettings({
        mode: config.mode,
        filters: config.filters,
        retentionDays: config.retentionDays,
      });

      // Use DB settings as source of truth (not openclaw.json)
      const dbSettings = db.getObserverSettings();
      const liveConfig = { ...resolvedConfig, ...dbSettings };
      setObserverState(db, liveConfig);
      api.logger.info(`[whatsapp-pro] Observer DB ready (mode: ${dbSettings.mode})`);
    }).catch((err) => {
      api.logger.error(`[whatsapp-pro] Observer DB init failed: ${String(err)}`);
    });

    // Log normal-path messages to the same DB
    api.on("message_received", (event, ctx) => {
      if (!ctx) return;
      if (!observerDb) {
        api.logger.warn(`[whatsapp-pro] message_received: DB not ready (register #${thisRegisterCall})`);
        return;
      }
      const hookCtx = ctx as Record<string, unknown>;
      if (hookCtx.channelId !== "whatsapp-pro") {
        api.logger.debug(`[whatsapp-pro] message_received: ignoring channelId=${String(hookCtx.channelId)} (register #${thisRegisterCall})`);
        return;
      }
      const hookEvent = event as Record<string, unknown>;
      const metadata = (hookEvent.metadata ?? {}) as Record<string, unknown>;

      const msgId = (metadata.messageId as string) ?? "null";
      const from = String(hookEvent.from);
      const account = String(hookCtx.accountId);
      const content = String(hookEvent.content ?? "").slice(0, 30);

      api.logger.warn(`[whatsapp-pro] HOOK message_received: register=#${thisRegisterCall} dbInstance=#${dbInstanceId} from=${from} account=${account} msgId=${msgId} content="${content}"`);

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

        // Verify: query back immediately to confirm it was inserted
        const count = observerDb.getStats({ accountId: account }).totalMessages;
        api.logger.warn(`[whatsapp-pro] INSERT OK: account=${account} totalMessages=${count}`);
      } catch (err) {
        api.logger.error(`[whatsapp-pro] INSERT FAILED: ${String(err)}`);
      }
    });

    // Safety layer: block outbound on observer accounts
    api.on(
      "message_sending",
      (event, ctx) => {
        if (!ctx) return;
        const hookCtx = ctx as Record<string, unknown>;
        if (hookCtx.channelId !== "whatsapp-pro") return;
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

    // Log outbound messages (agent replies, manual sends) to the same DB
    api.on("message_sent", (event, ctx) => {
      if (!ctx) return;
      if (!observerDb) {
        api.logger.warn(`[whatsapp-pro] message_sent: DB not ready (register #${thisRegisterCall})`);
        return;
      }
      const hookCtx = ctx as Record<string, unknown>;
      if (hookCtx.channelId !== "whatsapp-pro") {
        api.logger.debug(`[whatsapp-pro] message_sent: ignoring channelId=${String(hookCtx.channelId)} (register #${thisRegisterCall})`);
        return;
      }
      const hookEvent = event as Record<string, unknown>;

      api.logger.warn(`[whatsapp-pro] HOOK message_sent: register=#${thisRegisterCall} dbInstance=#${dbInstanceId} to=${String(hookEvent.to)} account=${String(hookCtx.accountId)}`);

      try {
        observerDb.insertMessage({
          messageId: (hookEvent.messageId as string) ?? undefined,
          accountId: (hookCtx.accountId as string) ?? "unknown",
          sender: (hookEvent.to as string) ?? "self",
          senderName: "self",
          conversationId: (hookCtx.conversationId as string) ?? (hookEvent.to as string),
          isGroup: Boolean(hookEvent.isGroup),
          content: hookEvent.content as string,
          timestamp: (hookEvent.timestamp as number) ?? Date.now(),
          messageType: "message",
          source: "pipeline",
        });

        const count = observerDb.getStats({ accountId: (hookCtx.accountId as string) ?? "unknown" }).totalMessages;
        api.logger.warn(`[whatsapp-pro] INSERT OK (outbound): totalMessages=${count}`);
      } catch (err) {
        api.logger.error(`[whatsapp-pro] INSERT FAILED (outbound): ${String(err)}`);
      }
    });

    api.logger.info(
      `[whatsapp-pro] Observer mode initialized (db: ${dbPath}, media: ${mediaPath})`,
    );
  },
});
