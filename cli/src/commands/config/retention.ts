import { Args, Command, Flags } from "@oclif/core";
import { resolveDbPath, openDb } from "../../lib/db-reader.js";

export default class ConfigRetention extends Command {
  static override description = "Get or set message retention period in days (0 = forever)";

  static override examples = [
    "wa-pro config retention",
    "wa-pro config retention 90",
    "wa-pro config retention 30 --account michael",
    "wa-pro config retention --reset --account michael",
  ];

  static override args = {
    days: Args.integer({
      required: false,
      description: "Retention period in days (0 = keep forever)",
    }),
  };

  static override flags = {
    account: Flags.string({ description: "Apply to this account (otherwise global)" }),
    reset: Flags.boolean({ description: "Remove per-account override (fall back to global)", default: false }),
    db: Flags.string({ env: "WA_PRO_DB", description: "Path to observer SQLite database" }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ConfigRetention);
    const dbPath = resolveDbPath(flags.db);
    const db = await openDb(dbPath);

    try {
      if (flags.reset && flags.account) {
        db.resetAccount(flags.account, "retentionDays");
        db.flush();
        process.stdout.write(`Reset retention for account ${flags.account} (using global default).\n`);
      } else if (args.days !== undefined) {
        if (args.days < 0) {
          this.error("Retention days must be 0 or positive");
        }
        if (flags.account) {
          db.setAccount(flags.account, "retentionDays", String(args.days));
        } else {
          db.setGlobal("retentionDays", String(args.days));
        }
        db.flush();
        const scope = flags.account ? `account ${flags.account}` : "global";
        process.stdout.write(
          args.days === 0
            ? `Retention set to: forever (${scope})\n`
            : `Retention set to: ${args.days} days (${scope})\n`,
        );
      } else {
        const settings = flags.account
          ? db.getAccountSettings(flags.account)
          : db.getObserverSettings();
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
