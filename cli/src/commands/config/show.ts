import { Command, Flags } from "@oclif/core";
import { resolveDbPath, openDb } from "../../lib/db-reader.js";
import { printOutput, type OutputFormat } from "../../lib/output.js";

export default class ConfigShow extends Command {
  static override description = "Show current observer settings (global or per-account)";

  static override examples = [
    "wa-pro config show",
    "wa-pro config show --account michael",
    "wa-pro config show --format json",
  ];

  static override flags = {
    account: Flags.string({ description: "Show settings for this account (with global fallback)" }),
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
      const settings = flags.account
        ? db.getAccountSettings(flags.account)
        : db.getObserverSettings();
      const format = flags.format as OutputFormat;
      const scope = flags.account ? `account: ${flags.account}` : "global";

      if (format === "table") {
        process.stdout.write(`Scope:         ${scope}\n`);
        process.stdout.write(`Mode:          ${settings.mode}\n`);
        process.stdout.write(`Retention:     ${settings.retentionDays} days\n`);
        process.stdout.write(`Allowlist:     ${settings.filters.allowlist.join(", ") || "(empty)"}\n`);
        process.stdout.write(`Blocklist:     ${settings.filters.blocklist.join(", ") || "(empty)"}\n`);
      } else {
        printOutput({ scope, ...settings }, "json");
      }
    } finally {
      db.close();
    }
  }
}
