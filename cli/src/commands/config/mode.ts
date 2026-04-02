import { Args, Command, Flags } from "@oclif/core";
import { resolveDbPath, openDb } from "../../lib/db-reader.js";
import { OBSERVER_MODES } from "../../../../src/observer/types.js";

export default class ConfigMode extends Command {
  static override description = "Get or set the observer recording/retrieval mode";

  static override examples = [
    "wa-pro config mode",
    "wa-pro config mode record-all-retrieve-all",
    "wa-pro config mode record-all-retrieve-filtered --account michael",
    "wa-pro config mode --reset --account michael",
  ];

  static override args = {
    mode: Args.string({
      required: false,
      description: "New mode to set",
      options: [...OBSERVER_MODES],
    }),
  };

  static override flags = {
    account: Flags.string({ description: "Apply to this account (otherwise sets global default)" }),
    reset: Flags.boolean({ description: "Remove per-account override (fall back to global)", default: false }),
    db: Flags.string({ env: "WA_PRO_DB", description: "Path to observer SQLite database" }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ConfigMode);
    const dbPath = resolveDbPath(flags.db);
    const db = await openDb(dbPath);

    try {
      if (flags.reset && flags.account) {
        db.resetAccount(flags.account, "mode");
        db.flush();
        process.stdout.write(`Reset mode for account ${flags.account} (using global default).\n`);
      } else if (args.mode) {
        if (flags.account) {
          db.setAccount(flags.account, "mode", args.mode);
        } else {
          db.setGlobal("mode", args.mode);
        }
        db.flush();
        const scope = flags.account ? `account ${flags.account}` : "global";
        process.stdout.write(`Mode set to: ${args.mode} (${scope})\n`);
      } else {
        const settings = flags.account
          ? db.getAccountSettings(flags.account)
          : db.getObserverSettings();
        process.stdout.write(`${settings.mode}\n`);
      }
    } finally {
      db.close();
    }
  }
}
