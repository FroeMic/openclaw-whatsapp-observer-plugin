import { Command, Flags } from "@oclif/core";
import { resolveDbPath, openDb } from "../../lib/db-reader.js";
import { printOutput, type OutputFormat } from "../../lib/output.js";

export default class ConfigShow extends Command {
  static override description = "Show current observer settings from the database";

  static override examples = [
    "wa-pro config show",
    "wa-pro config show --format json",
  ];

  static override flags = {
    db: Flags.string({ env: "WA_PRO_DB", description: "Path to observer SQLite database" }),
    format: Flags.string({
      options: ["json", "table"],
      default: "table",
      description: "Output format",
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(ConfigShow);
    const dbPath = resolveDbPath(flags.db);
    const db = await openDb(dbPath);

    try {
      const settings = db.getObserverSettings();
      const format = flags.format as OutputFormat;

      if (format === "table") {
        process.stdout.write(`Mode:          ${settings.mode}\n`);
        process.stdout.write(`Retention:     ${settings.retentionDays} days\n`);
        process.stdout.write(`Allowlist:     ${settings.filters.allowlist.join(", ") || "(empty)"}\n`);
        process.stdout.write(`Blocklist:     ${settings.filters.blocklist.join(", ") || "(empty)"}\n`);
      } else {
        printOutput(settings, "json");
      }
    } finally {
      db.close();
    }
  }
}
