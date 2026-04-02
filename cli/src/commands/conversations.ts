import { Command, Flags } from "@oclif/core";
import { resolveDbPath, openDb } from "../lib/db-reader.js";
import { printOutput, type OutputFormat } from "../lib/output.js";

export default class Conversations extends Command {
  static override description = "List conversations with message counts";

  static override examples = [
    "wa-pro conversations",
    "wa-pro conversations --limit 10 --format table",
    "wa-pro conversations --account personal",
  ];

  static override flags = {
    account: Flags.string({ description: "Filter by observer account ID" }),
    limit: Flags.integer({ default: 50, description: "Max results (max 200)" }),
    db: Flags.string({ env: "WA_PRO_DB", description: "Path to observer SQLite database" }),
    format: Flags.string({
      options: ["json", "table"],
      default: "json",
      description: "Output format",
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Conversations);
    const limit = Math.min(Math.max(flags.limit, 1), 200);

    const dbPath = resolveDbPath(flags.db);
    const db = await openDb(dbPath);

    try {
      const conversations = db.listConversations({
        accountId: flags.account,
        limit,
      });

      printOutput(conversations, flags.format as OutputFormat, [
        { key: "accountId", header: "Account", width: 12 },
        { key: "conversationId", header: "Conversation", width: 35 },
        { key: "groupName", header: "Group", width: 20 },
        { key: "contactName", header: "Contact", width: 20 },
        { key: "messageCount", header: "Messages", width: 10 },
        { key: "lastMessageAt", header: "Last Message", width: 24 },
        { key: "lastSender", header: "Last Sender", width: 20 },
      ]);
    } finally {
      db.close();
    }
  }
}
