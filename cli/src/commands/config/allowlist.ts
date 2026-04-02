import { Args, Command, Flags } from "@oclif/core";
import { resolveDbPath, openDb } from "../../lib/db-reader.js";

export default class ConfigAllowlist extends Command {
  static override description = "Manage the observer allowlist (filter which messages are queryable)";

  static override examples = [
    "wa-pro config allowlist list",
    "wa-pro config allowlist add +4917600000001",
    "wa-pro config allowlist add 120363406173840067@g.us",
    "wa-pro config allowlist remove +4917600000001",
    "wa-pro config allowlist clear",
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
    const { args, flags } = await this.parse(ConfigAllowlist);
    const dbPath = resolveDbPath(flags.db);
    const db = await openDb(dbPath);

    try {
      const key = "filters.allowlist";
      const current = parseJsonArray(db.getSetting(key)) ?? ["*"];

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
            // Remove wildcard if adding a specific entry
            const updated = current.filter((e) => e !== "*");
            updated.push(args.entry);
            db.setSetting(key, JSON.stringify(updated));
            db.flush();
            process.stdout.write(`Added: ${args.entry}\n`);
          } else {
            process.stdout.write(`Already in allowlist: ${args.entry}\n`);
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
          process.stdout.write("Allowlist cleared.\n");
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
