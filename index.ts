import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { whatsappPlugin, setObserverState } from "./src/channel.js";
import { setWhatsAppRuntime } from "./src/runtime.js";
import { getChannelConfig } from "./src/channel-config.js";
import { parseObserverConfig, isObserverAccount } from "./src/observer-config.js";
import { ObserverDB, preloadSqlJs } from "./src/observer/db.js";
import { requestBackfill } from "./src/observer/monitor.js";

export { whatsappPlugin } from "./src/channel.js";
export { setWhatsAppRuntime } from "./src/runtime.js";

let observerDb: ObserverDB | null = null;
let dbInitPromise: Promise<ObserverDB> | null = null;

export default definePluginEntry({
  id: "whatsapp-pro",
  name: "WhatsApp Pro",
  description: "WhatsApp channel plugin with observer mode for passive message logging",

  register(api) {
    // Set up runtime and register channel (same as defineChannelPluginEntry)
    setWhatsAppRuntime(api.runtime);
    api.registerChannel({ plugin: whatsappPlugin });

    // Observer setup — DB init (message logging happens at Baileys level, not via hooks)
    const config = parseObserverConfig(getChannelConfig(api.config));
    const dbPath = api.resolvePath(config.dbPath);
    const mediaPath = api.resolvePath(config.mediaPath);
    const resolvedConfig = { ...config, dbPath, mediaPath };

    // Create DB only once — register() may be called multiple times by openclaw
    if (!dbInitPromise) {
      dbInitPromise = ObserverDB.create(dbPath);
      dbInitPromise.then((db) => {
        observerDb = db;

        // Migrate unscoped keys to global.* prefix (one-time, from before per-account support)
        db.migrateToScopedKeys();

        // Seed global defaults from openclaw.json on first run
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
    }

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

    // Register gateway method for on-demand backfill (callable via wa-pro CLI)
    api.registerGatewayMethod("wa-pro.backfill", async (params) => {
      const { accountId, conversationId, count } = params as {
        accountId?: string;
        conversationId?: string;
        count?: number;
      };
      if (!accountId || !conversationId) {
        return { error: "accountId and conversationId are required" };
      }
      if (!observerDb) {
        return { error: "Observer DB not initialized" };
      }
      const result = await requestBackfill({
        accountId,
        conversationId,
        count,
        db: observerDb,
        logger: {
          info: (msg) => api.logger.info(msg),
          warn: (msg) => api.logger.warn(msg),
          error: (msg) => api.logger.error(msg),
        },
      });
      return { requested: result };
    });

    api.logger.info(
      `[whatsapp-pro] Observer mode initialized (db: ${dbPath}, media: ${mediaPath})`,
    );
  },
});
