import {
  fetchLatestBaileysVersion,
  isJidGroup,
  makeCacheableSignalKeyStore,
  makeWASocket,
  useMultiFileAuthState,
  type ConnectionState,
  type WAMessage,
} from "@whiskeysockets/baileys";
import { extractMessageContent, getContentType, normalizeMessageContent } from "@whiskeysockets/baileys";
import { isBlocked, isAllowed } from "./filter.js";
import { hasMedia, detectMediaType, downloadAndStoreMedia } from "./media.js";
import type { ObserverDB } from "./db.js";
import type { ObserverConfig, ChannelLogSink } from "./types.js";

export type ObserverMonitorParams = {
  accountId: string;
  authDir: string;
  abortSignal: AbortSignal;
  setStatus: (status: Record<string, unknown>) => void;
  config: ObserverConfig;
  db: ObserverDB;
  logger?: ChannelLogSink;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoff(attempt: number): number {
  const base = 2000;
  const max = 60_000;
  return Math.min(base * 2 ** attempt, max);
}

function jidToE164(jid: string | undefined | null): string | undefined {
  if (!jid) return undefined;
  const match = jid.match(/^(\d+)@/);
  if (!match) return undefined;
  return `+${match[1]}`;
}

function extractText(message: import("@whiskeysockets/baileys").proto.IMessage | undefined): string | undefined {
  if (!message) return undefined;
  const normalized = normalizeMessageContent(message);
  if (!normalized) return undefined;
  const extracted = extractMessageContent(normalized);
  const candidates = [normalized, extracted && extracted !== normalized ? extracted : undefined];
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (typeof candidate.conversation === "string" && candidate.conversation.trim()) {
      return candidate.conversation.trim();
    }
    const extended = candidate.extendedTextMessage?.text;
    if (extended?.trim()) return extended.trim();
    const caption =
      candidate.imageMessage?.caption ??
      candidate.videoMessage?.caption ??
      candidate.documentMessage?.caption;
    if (caption?.trim()) return caption.trim();
  }
  return undefined;
}

function waitForConnection(sock: ReturnType<typeof makeWASocket>): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const handler = (update: Partial<ConnectionState>) => {
      if (update.connection === "open") {
        sock.ev.off("connection.update", handler);
        resolve();
      } else if (update.connection === "close") {
        sock.ev.off("connection.update", handler);
        reject(new Error("Connection closed during startup"));
      }
    };
    sock.ev.on("connection.update", handler);
  });
}

function waitForCloseOrAbort(
  sock: ReturnType<typeof makeWASocket>,
  abortSignal: AbortSignal,
): Promise<void> {
  return new Promise<void>((resolve) => {
    const onClose = (update: Partial<ConnectionState>) => {
      if (update.connection === "close") {
        cleanup();
        resolve();
      }
    };
    const onAbort = () => {
      cleanup();
      try {
        sock.end(new Error("Observer aborted"));
      } catch {
        // ignore
      }
      resolve();
    };
    const cleanup = () => {
      sock.ev.off("connection.update", onClose);
      abortSignal.removeEventListener("abort", onAbort);
    };
    sock.ev.on("connection.update", onClose);
    abortSignal.addEventListener("abort", onAbort, { once: true });
  });
}

async function processObserverMessage(
  msg: WAMessage,
  sock: ReturnType<typeof makeWASocket>,
  ctx: {
    accountId: string;
    config: ObserverConfig;
    db: ObserverDB;
    logger?: ChannelLogSink;
  },
): Promise<void> {
  console.log("[observer-debug]", JSON.stringify(msg, null, 2));
  // Resolve JID: prefer remoteJidAlt (E.164-based) when remoteJid uses LID format
  const rawJid = msg.key?.remoteJid;
  const altJid = (msg.key as Record<string, unknown>)?.remoteJidAlt as string | undefined;
  const remoteJid = altJid && (altJid.endsWith("@s.whatsapp.net") || altJid.endsWith("@g.us"))
    ? altJid
    : rawJid;
  if (!remoteJid) return;
  if (
    !remoteJid.endsWith("@s.whatsapp.net") &&
    !remoteJid.endsWith("@g.us") &&
    !remoteJid.endsWith("@lid")
  ) {
    return;
  }

  const isGroup = isJidGroup(remoteJid);
  const sender = isGroup ? (msg.key?.participant ?? remoteJid) : remoteJid;
  const senderE164 = jidToE164(sender) ?? jidToE164(altJid);

  // Apply blocklist/allowlist
  if (isBlocked(senderE164 ?? sender, remoteJid, ctx.config.filters)) return;
  if (!isAllowed(senderE164 ?? sender, remoteJid, ctx.config.filters)) return;

  const timestamp = ((msg.messageTimestamp as number) ?? 0) * 1000 || Date.now();
  const rawMessage = msg.message as import("@whiskeysockets/baileys").proto.IMessage | undefined;
  const normalized = normalizeMessageContent(rawMessage);

  ctx.logger?.info(
    `Observer ${ctx.accountId}: received msg from ${senderE164 ?? sender}, ` +
    `hasNormalized=${!!normalized}, hasRaw=${!!rawMessage}, ` +
    `keys=${rawMessage ? Object.keys(rawMessage).join(",") : "none"}`,
  );

  // --- Reaction message ---
  const reactionMsg = normalized?.reactionMessage;
  if (reactionMsg) {
    ctx.db.insertMessage({
      messageId: msg.key?.id ?? undefined,
      accountId: ctx.accountId,
      sender: senderE164 ?? sender,
      senderName: msg.pushName ?? undefined,
      senderE164: senderE164 ?? undefined,
      conversationId: remoteJid,
      isGroup,
      content: reactionMsg.text || "[reaction removed]",
      refMessageId: reactionMsg.key?.id ?? undefined,
      messageType: "reaction",
      source: "observer",
      timestamp,
    });
    ctx.logger?.debug?.(`Observer ${ctx.accountId}: logged reaction from ${senderE164 ?? sender}`);
    return;
  }

  // --- Poll creation ---
  const pollMsg = normalized?.pollCreationMessage ?? normalized?.pollCreationMessageV3;
  if (pollMsg) {
    const options = pollMsg.options?.map((o) => o.optionName).join(", ") ?? "";
    ctx.db.insertMessage({
      messageId: msg.key?.id ?? undefined,
      accountId: ctx.accountId,
      sender: senderE164 ?? sender,
      senderName: msg.pushName ?? undefined,
      senderE164: senderE164 ?? undefined,
      conversationId: remoteJid,
      isGroup,
      content: `[poll] ${pollMsg.name ?? "Poll"}: ${options}`,
      messageType: "poll",
      source: "observer",
      timestamp,
    });
    ctx.logger?.debug?.(`Observer ${ctx.accountId}: logged poll from ${senderE164 ?? sender}`);
    return;
  }

  // --- Protocol messages: edits and deletions ---
  const protoMsg = normalized?.protocolMessage;
  if (protoMsg) {
    // Message edit
    if (protoMsg.editedMessage) {
      const editedText = extractText(
        protoMsg.editedMessage as import("@whiskeysockets/baileys").proto.IMessage,
      );
      ctx.db.insertMessage({
        messageId: msg.key?.id ?? undefined,
        accountId: ctx.accountId,
        sender: senderE164 ?? sender,
        senderName: msg.pushName ?? undefined,
        senderE164: senderE164 ?? undefined,
        conversationId: remoteJid,
        isGroup,
        content: editedText ?? "[edited message]",
        refMessageId: protoMsg.key?.id ?? undefined,
        messageType: "edit",
        source: "observer",
        timestamp,
      });
      ctx.logger?.debug?.(`Observer ${ctx.accountId}: logged edit from ${senderE164 ?? sender}`);
      return;
    }
    // Message deletion (type 0 = REVOKE)
    if (protoMsg.type === 0 && protoMsg.key) {
      ctx.db.insertMessage({
        messageId: msg.key?.id ?? undefined,
        accountId: ctx.accountId,
        sender: senderE164 ?? sender,
        senderName: msg.pushName ?? undefined,
        senderE164: senderE164 ?? undefined,
        conversationId: remoteJid,
        isGroup,
        content: "[message deleted]",
        refMessageId: protoMsg.key.id ?? undefined,
        messageType: "delete",
        source: "observer",
        timestamp,
      });
      ctx.logger?.debug?.(`Observer ${ctx.accountId}: logged deletion from ${senderE164 ?? sender}`);
      return;
    }
    // Other protocol messages (e.g. ephemeral settings) — skip
    ctx.logger?.info(`Observer ${ctx.accountId}: skipping protocol message type=${protoMsg.type}`);
    return;
  }

  // --- Regular text/media message ---
  const text = extractText(msg.message as import("@whiskeysockets/baileys").proto.IMessage | undefined);

  let groupName: string | undefined;
  if (isGroup) {
    try {
      const meta = await sock.groupMetadata(remoteJid);
      groupName = meta?.subject;
    } catch {
      // group metadata may fail
    }
  }

  // Download media if present
  let mediaLocalPath: string | undefined;
  let mediaMime: string | undefined;
  if (hasMedia(msg.message as import("@whiskeysockets/baileys").proto.IMessage | undefined)) {
    const result = await downloadAndStoreMedia(msg, sock, ctx.config.mediaPath);
    if (result) {
      mediaLocalPath = result.localPath;
      mediaMime = result.mime;
    }
  }

  const mediaType = detectMediaType(msg.message as import("@whiskeysockets/baileys").proto.IMessage | undefined);

  ctx.db.insertMessage({
    messageId: msg.key?.id ?? undefined,
    accountId: ctx.accountId,
    sender: senderE164 ?? sender,
    senderName: msg.pushName ?? undefined,
    senderE164: senderE164 ?? undefined,
    conversationId: remoteJid,
    isGroup,
    groupName,
    content: text ?? (mediaType ? `[${mediaType}]` : undefined),
    mediaType,
    mediaPath: mediaLocalPath,
    mediaMime,
    messageType: "message",
    source: "observer",
    timestamp,
  });

  ctx.logger?.debug?.(
    `Observer ${ctx.accountId}: logged message from ${senderE164 ?? sender} in ${remoteJid}`,
  );
}

/**
 * Observer monitor: creates a standalone Baileys connection that passively
 * listens for messages and logs them to SQLite.
 *
 * SAFETY: This function has NO send methods — it is structurally impossible
 * to send messages, read receipts, or responses from this monitor.
 */
export async function startObserverMonitor(params: ObserverMonitorParams): Promise<void> {
  const { accountId, authDir, abortSignal, config, db, logger } = params;
  let reconnectAttempts = 0;

  while (!abortSignal.aborted) {
    try {
      const { state, saveCreds } = await useMultiFileAuthState(authDir);
      const { version } = await fetchLatestBaileysVersion();

      const silentLogger = {
        level: "silent" as const,
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
        trace: () => {},
        fatal: () => {},
        child: () => silentLogger,
      };

      const sock = makeWASocket({
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, silentLogger as never),
        },
        version,
        logger: silentLogger as never,
        printQRInTerminal: false,
        browser: ["openclaw-observer", "cli", "1.0.0"],
        syncFullHistory: false,
        markOnlineOnConnect: false,
      });

      sock.ev.on("creds.update", saveCreds);

      await waitForConnection(sock);
      reconnectAttempts = 0;
      params.setStatus({ running: true, connected: true, lastConnectedAt: Date.now() });
      logger?.info(`Observer ${accountId}: connected`);

      // Periodic pruning
      if (config.retentionDays > 0) {
        const pruned = db.prune(config.retentionDays);
        if (pruned > 0) {
          logger?.info(`Observer ${accountId}: pruned ${pruned} old messages`);
        }
      }

      // CORE: Listen for messages, log to DB
      sock.ev.on("messages.upsert", async (upsert) => {
        logger?.info(
          `Observer ${accountId}: messages.upsert type=${upsert.type} count=${upsert.messages?.length ?? 0}`,
        );
        if (upsert.type !== "notify") return;
        for (const msg of upsert.messages ?? []) {
          try {
            await processObserverMessage(msg, sock, { accountId, config, db, logger });
          } catch (err) {
            logger?.error(`Observer ${accountId}: message processing error: ${String(err)}`);
          }
        }
      });

      // Listen for reactions (separate Baileys event)
      sock.ev.on("messages.reaction", (reactions) => {
        for (const { key, reaction } of reactions) {
          try {
            const remoteJid = key.remoteJid;
            if (!remoteJid) continue;
            const reactorJid = reaction.key?.participant ?? reaction.key?.remoteJid ?? remoteJid;
            const reactorE164 = jidToE164(reactorJid);

            if (isBlocked(reactorE164 ?? reactorJid, remoteJid, config.filters)) continue;
            if (!isAllowed(reactorE164 ?? reactorJid, remoteJid, config.filters)) continue;

            db.insertMessage({
              messageId: reaction.key?.id ?? undefined,
              accountId,
              sender: reactorE164 ?? reactorJid,
              senderE164: reactorE164 ?? undefined,
              conversationId: remoteJid,
              isGroup: isJidGroup(remoteJid),
              content: reaction.text || "[reaction removed]",
              refMessageId: key.id ?? undefined,
              messageType: "reaction",
              source: "observer",
              timestamp: Date.now(),
            });
          } catch (err) {
            logger?.error(`Observer ${accountId}: reaction processing error: ${String(err)}`);
          }
        }
      });

      // Wait for close/abort
      await waitForCloseOrAbort(sock, abortSignal);
      logger?.info(`Observer ${accountId}: disconnected`);
      params.setStatus({ connected: false });
    } catch (err) {
      logger?.error(`Observer ${accountId}: ${String(err)}`);
      params.setStatus({ connected: false, lastError: String(err) });
      reconnectAttempts++;
      const delay = backoff(reconnectAttempts);
      logger?.info(`Observer ${accountId}: reconnecting in ${delay}ms (attempt ${reconnectAttempts})`);
      await sleep(delay);
    }
  }

  logger?.info(`Observer ${accountId}: stopped (aborted)`);
  params.setStatus({ running: false, connected: false });
}
