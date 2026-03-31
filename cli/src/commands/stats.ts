import { Command, Flags } from "@oclif/core";
import { resolveDbPath, openDb } from "../lib/db-reader.js";
import { printOutput, type OutputFormat } from "../lib/output.js";

export default class Stats extends Command {
  static override description = "Show message statistics and analytics";

  static override examples = [
    "wa-pro stats",
    "wa-pro stats --group-by sender",
    "wa-pro stats --after 2026-03-01 --group-by day --format table",
    "wa-pro stats --account personal --group-by hour",
  ];

  static override flags = {
    account: Flags.string({ description: "Filter by observer account ID" }),
    after: Flags.string({ description: "Only count messages after this date (ISO 8601)" }),
    "group-by": Flags.string({
      options: ["sender", "group", "day", "hour"],
      description: "Group results by dimension",
    }),
    db: Flags.string({ env: "WA_PRO_DB", description: "Path to observer SQLite database" }),
    format: Flags.string({
      options: ["json", "table"],
      default: "json",
      description: "Output format",
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Stats);

    const dbPath = resolveDbPath(flags.db);
    const db = await openDb(dbPath);

    try {
      const groupBy = flags["group-by"] as "sender" | "group" | "day" | "hour" | undefined;
      const stats = db.getStats({
        accountId: flags.account,
        afterDate: flags.after ? new Date(flags.after).getTime() : undefined,
        groupBy,
      });

      const format = flags.format as OutputFormat;

      if (format === "table") {
        process.stdout.write(`Total messages:       ${stats.totalMessages}\n`);
        process.stdout.write(`Unique senders:       ${stats.uniqueSenders}\n`);
        process.stdout.write(`Unique conversations: ${stats.uniqueConversations}\n`);
        if (stats.firstMessageAt) {
          process.stdout.write(`First message:        ${new Date(stats.firstMessageAt).toISOString()}\n`);
        }
        if (stats.lastMessageAt) {
          process.stdout.write(`Last message:         ${new Date(stats.lastMessageAt).toISOString()}\n`);
        }
        if (stats.grouped && stats.grouped.length > 0) {
          process.stdout.write(`\nGrouped by ${groupBy}:\n`);
          printOutput(stats.grouped, "table", [
            { key: "key", header: groupBy ?? "Key", width: 30 },
            { key: "count", header: "Count", width: 10 },
          ]);
        }
      } else {
        printOutput(stats, "json");
      }
    } finally {
      db.close();
    }
  }
}
