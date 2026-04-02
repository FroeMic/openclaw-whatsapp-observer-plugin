import { Args, Command, Flags } from "@oclif/core";
import { resolveDbPath, openDb } from "../../lib/db-reader.js";

export default class ConfigBlocklist extends Command {
  static override description = "Manage the observer blocklist (block messages from specific senders/groups)";

  static override examples = [
    "wa-pro config blocklist list",
    "wa-pro config blocklist add +4917600000001",
    "wa-pro config blocklist add 120363406173840067@g.us",
    "wa-pro config blocklist remove +4917600000001",
    "wa-pro config blocklist clear",
  ];

  static override args = {
    action: Args.string({
      required: true,
      description: "Action to perform",
      options: ["list", "add", "remove", "clear"],
    }),
    entry: Args.string({
      required: false,
      description: "Phone number (E.164) or JID to add/remove",
    }),
  };

  static override flags = {
    db: Flags.string({ env: "WA_PRO_DB", description: "Path to observer SQLite database" }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ConfigBlocklist);
    const dbPath = resolveDbPath(flags.db);
    const db = await openDb(dbPath);

    try {
      const key = "filters.blocklist";
      const current = parseJsonArray(db.getSetting(key)) ?? [];

      switch (args.action) {
        case "list":
          if (current.length === 0) {
            process.stdout.write("(empty)\n");
          } else {
            for (const entry of current) {
              process.stdout.write(`${entry}\n`);
            }
          }
          break;

        case "add":
          if (!args.entry) {
            this.error("Entry is required for 'add' action");
          }
          if (!current.includes(args.entry)) {
            current.push(args.entry);
            db.setSetting(key, JSON.stringify(current));
            db.flush();
            process.stdout.write(`Added: ${args.entry}\n`);
          } else {
            process.stdout.write(`Already in blocklist: ${args.entry}\n`);
          }
          break;

        case "remove":
          if (!args.entry) {
            this.error("Entry is required for 'remove' action");
          }
          {
            const updated = current.filter((e) => e !== args.entry);
            db.setSetting(key, JSON.stringify(updated));
            db.flush();
            process.stdout.write(`Removed: ${args.entry}\n`);
          }
          break;

        case "clear":
          db.setSetting(key, "[]");
          db.flush();
          process.stdout.write("Blocklist cleared.\n");
          break;
      }
    } finally {
      db.close();
    }
  }
}

function parseJsonArray(raw: string | undefined): string[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as string[] : null;
  } catch {
    return null;
  }
}
