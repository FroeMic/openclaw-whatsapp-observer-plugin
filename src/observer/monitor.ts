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
import type { ObserverConfig, ChannelLogSink, MessageSource } from "./types.js";

// Active observer sockets keyed by accountId — used for on-demand backfill
const activeSockets = new Map<string, ReturnType<typeof makeWASocket>>();

/** Get the active Baileys socket for an observer account (if connected). */
export function getObserverSocket(accountId: string): ReturnType<typeof makeWASocket> | undefined {
  return activeSockets.get(accountId);
}

/**
 * Request on-demand history backfill for a chat.
 * Uses Baileys' fetchMessageHistory() which requests older messages from the phone.
 * Results arrive via the messaging-history.set event and are automatically processed.
 *
 * @returns Number of messages requested, or null if account not connected.
 */
export async function requestBackfill(params: {
  accountId: string;
  conversationId: string;
  count?: number;
  db: ObserverDB;
  logger?: ChannelLogSink;
}): Promise<number | null> {
  const sock = activeSockets.get(params.accountId);
  if (!sock) {
    params.logger?.warn(`Backfill: account ${params.accountId} not connected`);
    return null;
  }

  const count = Math.min(params.count ?? 50, 50); // Baileys max is 50 per request
  const oldest = params.db.getOldestMessage(params.conversationId, params.accountId);

  if (!oldest) {
    params.logger?.info(`Backfill: no messages in ${params.conversationId}, cannot anchor`);
    return null;
  }

  const msgKey = {
    remoteJid: params.conversationId,
    id: oldest.message_id as string,
    fromMe: false,
  };
  const timestamp = (oldest.timestamp as number) / 1000; // Baileys uses seconds

  params.logger?.info(
    `Backfill: requesting ${count} messages before ${new Date(oldest.timestamp as number).toISOString()} in ${params.conversationId}`,
  );

  try {
    await sock.fetchMessageHistory(count, msgKey, Math.floor(timestamp));
    return count;
  } catch (err) {
    params.logger?.error(`Backfill failed: ${String(err)}`);
    return null;
  }
}

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

/** Safe jidToE164 that returns null for LID JIDs (which are not real phone numbers). */
function safeJidToE164(jid: string | null | undefined): string | null {
  if (!jid) return null;
  if (jid.endsWith("@lid")) return null;
  return jidToE164(jid);
}

export async function processObserverMessage(
  msg: WAMessage,
  sock: ReturnType<typeof makeWASocket> | null,
  ctx: {
    accountId: string;
    config: ObserverConfig;
    db: ObserverDB;
    logger?: ChannelLogSink;
    source?: MessageSource;
    /** LID→E.164 lookup from Baileys signal repository (for resolving LID JIDs). */
    lidLookup?: unknown;
    /** Auth dir for JID resolution fallback. */
    authDir?: string;
  },
): Promise<void> {
  // Strip leading '+' from JIDs — WhatsApp JIDs use digits only before the @
  const normalizeJid = (jid: string): string => jid.replace(/^\+/, "");

  // Resolve JID: prefer remoteJidAlt (E.164-based) when remoteJid uses LID format
  const rawJid = msg.key?.remoteJid;
  const altJid = (msg.key as Record<string, unknown>)?.remoteJidAlt as string | undefined;

  let remoteJid = altJid && (altJid.endsWith("@s.whatsapp.net") || altJid.endsWith("@g.us"))
    ? normalizeJid(altJid)
    : rawJid;
  if (!remoteJid) return;

  // Resolve LID JIDs to E.164 using the signal repository's lid mapping
  if (remoteJid.endsWith("@lid") && (ctx.lidLookup || ctx.authDir)) {
    try {
      const { resolveJidToE164 } = await import("openclaw/plugin-sdk/text-runtime");
      const resolved = await resolveJidToE164(remoteJid, {
        authDir: ctx.authDir,
        lidLookup: ctx.lidLookup,
      });
      if (resolved) {
        const normalized = normalizeJid(resolved);
        remoteJid = normalized.includes("@") ? normalized : `${normalized}@s.whatsapp.net`;
      }
    } catch {
      // SDK not available (e.g., in tests) — fall back to raw JID
    }
  }

  if (
    !remoteJid.endsWith("@s.whatsapp.net") &&
    !remoteJid.endsWith("@g.us") &&
    !remoteJid.endsWith("@lid")
  ) {
    return;
  }

  const isGroup = isJidGroup(remoteJid);
  const sender = isGroup ? (msg.key?.participant ?? remoteJid) : remoteJid;
  let senderE164 = safeJidToE164(sender) ?? safeJidToE164(altJid);

  // Resolve sender LID if still unresolved
  if (!senderE164 && sender.endsWith("@lid") && (ctx.lidLookup || ctx.authDir)) {
    try {
      const { resolveJidToE164 } = await import("openclaw/plugin-sdk/text-runtime");
      senderE164 = await resolveJidToE164(sender, {
        authDir: ctx.authDir,
        lidLookup: ctx.lidLookup,
      }) ?? undefined;
    } catch {
      // SDK not available — keep senderE164 as-is
    }
  }

  // Apply blocklist/allowlist at ingestion time only in record-filtered mode
  // Use per-account settings from DB when available, otherwise fall back to config
  const accountSettings = ctx.db.getAccountSettings(ctx.accountId);
  if (accountSettings.mode === "record-filtered-retrieve-filtered") {
    if (isBlocked(senderE164 ?? sender, remoteJid, accountSettings.filters)) return;
    if (!isAllowed(senderE164 ?? sender, remoteJid, accountSettings.filters)) return;
  }

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
      source: ctx.source ?? "observer",
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
      source: ctx.source ?? "observer",
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
        source: ctx.source ?? "observer",
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
        source: ctx.source ?? "observer",
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
  if (isGroup && sock) {
    try {
      const meta = await sock.groupMetadata(remoteJid);
      groupName = meta?.subject;
    } catch {
      // group metadata may fail
    }
  }

  // Download media if present (requires sock for download)
  let mediaLocalPath: string | undefined;
  let mediaMime: string | undefined;
  if (sock && hasMedia(msg.message as import("@whiskeysockets/baileys").proto.IMessage | undefined)) {
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
    source: ctx.source ?? "observer",
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
        syncFullHistory: true,
        markOnlineOnConnect: false,
      });

      sock.ev.on("creds.update", saveCreds);

      await waitForConnection(sock);
      reconnectAttempts = 0;
      activeSockets.set(accountId, sock);
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
        if (upsert.type !== "notify" && upsert.type !== "append") return;
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
            const reactorE164 = safeJidToE164(reactorJid);

            const reactionSettings = db.getAccountSettings(accountId);
            if (reactionSettings.mode === "record-filtered-retrieve-filtered") {
              if (isBlocked(reactorE164 ?? reactorJid, remoteJid, reactionSettings.filters)) continue;
              if (!isAllowed(reactorE164 ?? reactorJid, remoteJid, reactionSettings.filters)) continue;
            }

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

      // Listen for history sync (initial + on-demand backfill)
      sock.ev.on("messaging-history.set" as never, (data: {
        chats?: Array<{ id?: string; name?: string }>;
        contacts?: Array<{ id?: string; notify?: string; name?: string }>;
        messages?: Array<WAMessage>;
        isLatest?: boolean;
      }) => {
        const msgCount = data.messages?.length ?? 0;
        const contactCount = data.contacts?.length ?? 0;
        logger?.info(`Observer ${accountId}: history sync — ${msgCount} messages, ${contactCount} contacts`);

        // Process historical messages
        if (data.messages) {
          for (const msg of data.messages) {
            processObserverMessage(msg, sock, { accountId, config, db, logger }).catch((err) => {
              logger?.error(`Observer ${accountId}: history message error: ${String(err)}`);
            });
          }
        }

        // Store contacts
        if (data.contacts) {
          for (const contact of data.contacts) {
            if (!contact.id) continue;
            db.upsertContact({
              jid: contact.id,
              accountId,
              pushName: contact.notify ?? contact.name,
              phone: safeJidToE164(contact.id) ?? undefined,
            });
          }
        }

        // Store chat metadata as group contacts
        if (data.chats) {
          for (const chat of data.chats) {
            if (!chat.id || !chat.name) continue;
            if (isJidGroup(chat.id)) {
              db.upsertContact({
                jid: chat.id,
                accountId,
                isGroup: true,
                groupSubject: chat.name,
              });
            }
          }
        }
      });

      // Listen for contact updates
      sock.ev.on("contacts.upsert", (contacts) => {
        for (const contact of contacts) {
          if (!contact.id) continue;
          db.upsertContact({
            jid: contact.id,
            accountId,
            pushName: contact.notify ?? contact.name,
            phone: jidToE164(contact.id) ?? undefined,
          });
        }
      });

      sock.ev.on("contacts.update", (updates) => {
        for (const update of updates) {
          if (!update.id) continue;
          const existing = db.getContact(update.id);
          db.upsertContact({
            jid: update.id,
            accountId,
            pushName: update.notify ?? (existing?.push_name as string) ?? undefined,
            phone: safeJidToE164(update.id) ?? (existing?.phone as string) ?? undefined,
          });
        }
      });

      // Listen for group metadata updates
      sock.ev.on("groups.upsert", (groups) => {
        for (const group of groups) {
          if (!group.id) continue;
          db.upsertContact({
            jid: group.id,
            accountId,
            isGroup: true,
            groupSubject: group.subject,
          });
        }
      });

      sock.ev.on("groups.update", (updates) => {
        for (const update of updates) {
          if (!update.id) continue;
          db.upsertContact({
            jid: update.id,
            accountId,
            isGroup: true,
            groupSubject: update.subject ?? undefined,
          });
        }
      });

      // Listen for message edits
      sock.ev.on("messages.update", (updates) => {
        for (const update of updates) {
          if (!update.key?.remoteJid || !update.key?.id) continue;
          if (update.update?.messageStubType === 1) {
            // Message revoked/deleted
            db.insertMessage({
              messageId: update.key.id,
              accountId,
              sender: update.key.participant ?? update.key.remoteJid ?? "unknown",
              conversationId: update.key.remoteJid,
              isGroup: isJidGroup(update.key.remoteJid),
              messageType: "delete",
              refMessageId: update.key.id,
              source: "observer",
              timestamp: Date.now(),
            });
          }
        }
      });

      // Poll for backfill requests from the CLI
      const backfillPollInterval = setInterval(async () => {
        try {
          const pending = db.getPendingBackfills(accountId);
          for (const { key, value: request } of pending) {
            try {
              const conversationId = request.conversationId as string;
              const anchorMessageId = request.anchorMessageId as string;
              const anchorTimestamp = request.anchorTimestamp as number;
              const backfillCount = (request.count as number) ?? 50;
              logger?.info(`Observer ${accountId}: processing backfill for ${conversationId}`);
              const msgKey = {
                remoteJid: conversationId,
                id: anchorMessageId,
                fromMe: false,
              };
              await sock.fetchMessageHistory(
                backfillCount,
                msgKey,
                Math.floor(anchorTimestamp / 1000),
              );
              logger?.info(`Observer ${accountId}: backfill request sent for ${conversationId}`);
            } catch (err) {
              logger?.error(`Observer ${accountId}: backfill error: ${String(err)}`);
            }
            // Remove processed request
            db.deleteSetting(key);
          }
        } catch {
          // polling error — ignore
        }
      }, 5_000);

      // Wait for close/abort
      await waitForCloseOrAbort(sock, abortSignal);
      clearInterval(backfillPollInterval);
      activeSockets.delete(accountId);
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
