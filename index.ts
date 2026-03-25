import { createInterface } from "node:readline";
import { defineChannelPluginEntry } from "openclaw/plugin-sdk/core";
import { whatsappPlugin, setObserverState } from "./src/channel.js";
import { setWhatsAppRuntime } from "./src/runtime.js";
import { parseObserverConfig } from "./src/observer-config.js";
import { ObserverDB } from "./src/observer/db.js";
import { registerObserverTools } from "./src/observer/tools.js";

export { whatsappPlugin } from "./src/channel.js";
export { setWhatsAppRuntime } from "./src/runtime.js";

let observerDb: ObserverDB | null = null;

export default defineChannelPluginEntry({
  id: "whatsapp-pro",
  name: "WhatsApp Pro",
  description: "WhatsApp channel plugin with observer mode for passive message logging",
  plugin: whatsappPlugin,
  setRuntime: setWhatsAppRuntime,

  async registerFull(api) {
    const config = parseObserverConfig(api.pluginConfig);
    const dbPath = api.resolvePath(config.dbPath);
    const mediaPath = api.resolvePath(config.mediaPath);
    const resolvedConfig = { ...config, dbPath, mediaPath };

    observerDb = await ObserverDB.create(dbPath);
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

    // CLI: openclaw wa-pro setup <accountId>
    api.registerCli(
      ({ program }) => {
        const waPro = program.command("wa-pro").description("WhatsApp Pro plugin commands");

        waPro
          .command("setup")
          .argument("[accountId]", "Account ID (default: personal)")
          .description("Set up a WhatsApp account with interactive login")
          .option("--verbose", "Verbose connection logs", false)
          .action(async (accountId?: string, opts?: { verbose?: boolean }) => {
            const id = accountId?.trim() || "personal";

            // Prompt for account type
            const rl = createInterface({ input: process.stdin, output: process.stdout });
            const accountType = await new Promise<string>((resolve) => {
              rl.question(
                `\nAccount type for "${id}":\n` +
                  `  1) normal   — full agent pipeline (receives messages, agent replies)\n` +
                  `  2) observer — passive logging only (no sessions, no replies, no sends)\n\n` +
                  `Choose [1/2] (default: 2): `,
                (answer) => {
                  rl.close();
                  const trimmed = answer.trim();
                  resolve(trimmed === "1" || trimmed === "normal" ? "normal" : "observer");
                },
              );
            });

            const isObserver = accountType === "observer";
            console.log(`\nConfiguring "${id}" as ${isObserver ? "observer" : "normal"} account...\n`);

            // Bootstrap config
            const cfg = api.runtime.config.loadConfig() as Record<string, unknown>;
            const channels = (cfg.channels ?? {}) as Record<string, unknown>;
            const whatsapp = (channels.whatsapp ?? {}) as Record<string, unknown>;
            const accounts = (whatsapp.accounts ?? {}) as Record<string, Record<string, unknown>>;
            const existing = accounts[id] ?? {};

            const updatedAccount: Record<string, unknown> = {
              ...existing,
              enabled: true,
            };

            if (isObserver) {
              updatedAccount.observerMode = true;
            } else {
              updatedAccount.dmPolicy = existing.dmPolicy ?? "pairing";
              delete updatedAccount.observerMode;
            }

            const nextConfig = {
              ...cfg,
              channels: {
                ...channels,
                whatsapp: {
                  ...whatsapp,
                  accounts: {
                    ...accounts,
                    [id]: updatedAccount,
                  },
                },
              },
            };

            await api.runtime.config.writeConfigFile(nextConfig);
            console.log(`Config updated: channels.whatsapp.accounts.${id}\n`);

            // Trigger WhatsApp login
            console.log("Starting WhatsApp login — scan the QR code with your phone...\n");
            const { loginWeb } = await import("./src/login.js");
            await loginWeb(Boolean(opts?.verbose), undefined, undefined, id);

            console.log(
              `\n${isObserver ? "Observer" : "Normal"} account "${id}" is linked.` +
                `\nRestart the gateway to start ${isObserver ? "observing" : "processing"} messages:` +
                `\n  openclaw gateway restart\n`,
            );
          });

        waPro
          .command("query")
          .argument("<search>", "Search query")
          .option("--limit <n>", "Max results", "20")
          .description("Search observer message log")
          .action(async (search: string, opts: { limit: string }) => {
            if (!observerDb) {
              console.error("Observer DB not initialized.");
              return;
            }
            const results = observerDb.search({ query: search, limit: parseInt(opts.limit, 10) });
            if (results.length === 0) {
              console.log("No messages found.");
              return;
            }
            for (const r of results) {
              const ts = new Date(r.timestamp as number).toISOString().slice(0, 19);
              const sender = r.sender_name ?? r.sender;
              const group = r.group_name ? ` [${r.group_name}]` : "";
              const type = r.message_type !== "message" ? ` (${r.message_type})` : "";
              console.log(`${ts} ${sender}${group}${type}: ${r.content}`);
            }
            console.log(`\n${results.length} result(s)`);
          });
      },
      { commands: ["wa-pro"] },
    );

    api.logger.info(
      `[whatsapp-pro] Observer mode initialized (db: ${dbPath}, media: ${mediaPath})`,
    );
  },
});
