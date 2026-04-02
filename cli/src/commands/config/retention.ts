import { Args, Command, Flags } from "@oclif/core";
import { resolveDbPath, openDb } from "../../lib/db-reader.js";

export default class ConfigRetention extends Command {
  static override description = "Get or set message retention period in days (0 = forever)";

  static override examples = [
    "wa-pro config retention",
    "wa-pro config retention 90",
    "wa-pro config retention 0",
  ];

  static override args = {
    days: Args.integer({
      required: false,
      description: "Retention period in days (0 = keep forever)",
    }),
  };

  static override flags = {
    db: Flags.string({ env: "WA_PRO_DB", description: "Path to observer SQLite database" }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ConfigRetention);
    const dbPath = resolveDbPath(flags.db);
    const db = await openDb(dbPath);

    try {
      if (args.days !== undefined) {
        if (args.days < 0) {
          this.error("Retention days must be 0 or positive");
        }
        db.setSetting("retentionDays", String(args.days));
        db.flush();
        process.stdout.write(
          args.days === 0
            ? "Retention set to: forever (0)\n"
            : `Retention set to: ${args.days} days\n`,
        );
      } else {
        const settings = db.getObserverSettings();
        process.stdout.write(
          settings.retentionDays === 0
            ? "forever (0)\n"
            : `${settings.retentionDays} days\n`,
        );
      }
    } finally {
      db.close();
    }
  }
}
