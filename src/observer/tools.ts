import { Type } from "@sinclair/typebox";
import type { ObserverDB } from "./db.js";

type PluginApi = {
  registerTool: (tool: Record<string, unknown>, opts?: { name: string }) => void;
};

export function registerObserverTools(api: PluginApi, db: ObserverDB): void {
  // Tool 1: Full-text search
  api.registerTool(
    {
      name: "wa_observer_search",
      label: "WhatsApp Observer Search",
      description:
        "Search through passively logged WhatsApp messages using full-text keyword search. " +
        "Use this to find specific messages, topics, or conversations from observer accounts.",
      parameters: Type.Object({
        query: Type.String({ description: "Full-text search query" }),
        sender: Type.Optional(
          Type.String({ description: "Filter by sender (E.164 number, JID, or name)" }),
        ),
        group: Type.Optional(
          Type.String({ description: "Filter by group (JID or name)" }),
        ),
        afterDate: Type.Optional(
          Type.String({
            description: "Only messages after this date (ISO 8601, e.g. 2026-03-01)",
          }),
        ),
        beforeDate: Type.Optional(
          Type.String({
            description: "Only messages before this date (ISO 8601, e.g. 2026-03-25)",
          }),
        ),
        limit: Type.Optional(
          Type.Number({ description: "Max results (default 50, max 200)" }),
        ),
      }),
      async execute(
        _toolCallId: string,
        params: {
          query: string;
          sender?: string;
          group?: string;
          afterDate?: string;
          beforeDate?: string;
          limit?: number;
        },
      ) {
        const results = db.search({
          query: params.query,
          sender: params.sender,
          group: params.group,
          afterDate: params.afterDate ? new Date(params.afterDate).getTime() : undefined,
          beforeDate: params.beforeDate ? new Date(params.beforeDate).getTime() : undefined,
          limit: params.limit,
        });

        if (results.length === 0) {
          return {
            content: [{ type: "text", text: "No messages found matching your query." }],
            details: { count: 0 },
          };
        }

        const lines = results.map((r) => {
          const ts = new Date(r.timestamp as number).toISOString();
          const sender = r.sender_name ?? r.sender;
          const group = r.group_name ? ` [${r.group_name}]` : "";
          return `[${ts}] ${sender}${group}: ${r.content}`;
        });

        return {
          content: [
            {
              type: "text",
              text: `Found ${results.length} messages:\n\n${lines.join("\n")}`,
            },
          ],
          details: { count: results.length, messages: results },
        };
      },
    },
    { name: "wa_observer_search" },
  );

  // Tool 2: Recent messages
  api.registerTool(
    {
      name: "wa_observer_recent",
      label: "WhatsApp Observer Recent",
      description:
        "Get the most recent passively logged WhatsApp messages. " +
        "Optionally filter by conversation or account.",
      parameters: Type.Object({
        conversationId: Type.Optional(
          Type.String({ description: "Filter by conversation JID" }),
        ),
        accountId: Type.Optional(
          Type.String({ description: "Filter by observer account ID" }),
        ),
        limit: Type.Optional(
          Type.Number({ description: "Max results (default 50, max 200)" }),
        ),
      }),
      async execute(
        _toolCallId: string,
        params: {
          conversationId?: string;
          accountId?: string;
          limit?: number;
        },
      ) {
        const results = db.getRecent({
          conversationId: params.conversationId,
          accountId: params.accountId,
          limit: params.limit,
        });

        if (results.length === 0) {
          return {
            content: [{ type: "text", text: "No recent messages found." }],
            details: { count: 0 },
          };
        }

        const lines = results.map((r) => {
          const ts = new Date(r.timestamp as number).toISOString();
          const sender = r.sender_name ?? r.sender;
          const group = r.group_name ? ` [${r.group_name}]` : "";
          return `[${ts}] ${sender}${group}: ${r.content}`;
        });

        return {
          content: [
            {
              type: "text",
              text: `${results.length} recent messages:\n\n${lines.join("\n")}`,
            },
          ],
          details: { count: results.length, messages: results },
        };
      },
    },
    { name: "wa_observer_recent" },
  );

  // Tool 3: List conversations
  api.registerTool(
    {
      name: "wa_observer_conversations",
      label: "WhatsApp Observer Conversations",
      description:
        "List conversations with message counts from passively logged WhatsApp messages. " +
        "Shows which conversations have the most activity.",
      parameters: Type.Object({
        accountId: Type.Optional(
          Type.String({ description: "Filter by observer account ID" }),
        ),
        limit: Type.Optional(
          Type.Number({ description: "Max results (default 50, max 200)" }),
        ),
      }),
      async execute(
        _toolCallId: string,
        params: { accountId?: string; limit?: number },
      ) {
        const conversations = db.listConversations({
          accountId: params.accountId,
          limit: params.limit,
        });

        if (conversations.length === 0) {
          return {
            content: [{ type: "text", text: "No conversations found." }],
            details: { count: 0 },
          };
        }

        const lines = conversations.map((c) => {
          const name = c.groupName ?? c.conversationId;
          const lastAt = new Date(c.lastMessageAt).toISOString();
          return `${name}: ${c.messageCount} messages (last: ${lastAt}, from: ${c.lastSender ?? "unknown"})`;
        });

        return {
          content: [
            {
              type: "text",
              text: `${conversations.length} conversations:\n\n${lines.join("\n")}`,
            },
          ],
          details: { count: conversations.length, conversations },
        };
      },
    },
    { name: "wa_observer_conversations" },
  );

  // Tool 4: Statistics
  api.registerTool(
    {
      name: "wa_observer_stats",
      label: "WhatsApp Observer Stats",
      description:
        "Get statistics about passively logged WhatsApp messages. " +
        "Can group by sender, group, day, or hour for analysis.",
      parameters: Type.Object({
        accountId: Type.Optional(
          Type.String({ description: "Filter by observer account ID" }),
        ),
        afterDate: Type.Optional(
          Type.String({
            description: "Only count messages after this date (ISO 8601)",
          }),
        ),
        groupBy: Type.Optional(
          Type.Unsafe<"sender" | "group" | "day" | "hour">({
            type: "string",
            enum: ["sender", "group", "day", "hour"],
            description: "Group results by sender, group, day, or hour",
          }),
        ),
      }),
      async execute(
        _toolCallId: string,
        params: {
          accountId?: string;
          afterDate?: string;
          groupBy?: "sender" | "group" | "day" | "hour";
        },
      ) {
        const stats = db.getStats({
          accountId: params.accountId,
          afterDate: params.afterDate ? new Date(params.afterDate).getTime() : undefined,
          groupBy: params.groupBy,
        });

        const lines = [
          `Total messages: ${stats.totalMessages}`,
          `Unique senders: ${stats.uniqueSenders}`,
          `Unique conversations: ${stats.uniqueConversations}`,
          stats.firstMessageAt
            ? `First message: ${new Date(stats.firstMessageAt).toISOString()}`
            : null,
          stats.lastMessageAt
            ? `Last message: ${new Date(stats.lastMessageAt).toISOString()}`
            : null,
        ].filter(Boolean);

        if (stats.grouped && stats.grouped.length > 0) {
          lines.push("", `Grouped by ${params.groupBy}:`);
          for (const g of stats.grouped) {
            lines.push(`  ${g.key}: ${g.count}`);
          }
        }

        return {
          content: [{ type: "text", text: lines.join("\n") }],
          details: stats,
        };
      },
    },
    { name: "wa_observer_stats" },
  );
}
