import { defineChannelPluginEntry } from "openclaw/plugin-sdk/core";
import { whatsappPlugin, setObserverState } from "./src/channel.js";
import { setWhatsAppRuntime } from "./src/runtime.js";
import { parseObserverConfig } from "./src/observer-config.js";
import { ObserverDB } from "./src/observer/db.js";
import { registerObserverTools } from "./src/observer/tools.js";
import type { ObserverConfig } from "./src/observer/types.js";

export { whatsappPlugin } from "./src/channel.js";
export { setWhatsAppRuntime } from "./src/runtime.js";

let observerDb: ObserverDB | null = null;
let observerConfig: ObserverConfig | null = null;

export default defineChannelPluginEntry({
  id: "whatsapp-pro",
  name: "WhatsApp Pro",
  description: "WhatsApp channel plugin with observer mode for passive message logging",
  plugin: whatsappPlugin,
  setRuntime: setWhatsAppRuntime,

  registerFull(api) {
    const config = parseObserverConfig(api.pluginConfig);
    if (!config) return;

    const dbPath = api.resolvePath(config.dbPath);
    const mediaPath = api.resolvePath(config.mediaPath);
    const resolvedConfig = { ...config, dbPath, mediaPath };

    observerDb = new ObserverDB(dbPath);
    observerConfig = resolvedConfig;
    setObserverState(observerDb, resolvedConfig);

    registerObserverTools(api, observerDb);

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
        if (!ctx || !observerDb) return;
        const hookCtx = ctx as Record<string, unknown>;
        if (hookCtx.channelId !== "whatsapp") return;
        const accountId = hookCtx.accountId as string | undefined;
        if (!accountId) return;

        const cfg = hookCtx.config as Record<string, unknown> | undefined;
        const waConfig = cfg?.channels as Record<string, unknown> | undefined;
        const waAccounts = (waConfig?.whatsapp as Record<string, unknown>)?.accounts as
          | Record<string, Record<string, unknown>>
          | undefined;
        const accountConfig = waAccounts?.[accountId];

        if (accountConfig?.observerMode) {
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
