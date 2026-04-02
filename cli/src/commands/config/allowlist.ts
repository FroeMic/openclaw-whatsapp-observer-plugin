import { Args, Command, Flags } from "@oclif/core";
import { resolveDbPath, openDb } from "../../lib/db-reader.js";

export default class ConfigAllowlist extends Command {
  static override description = "Manage the observer allowlist (filter which messages are queryable)";

  static override examples = [
    "wa-pro config allowlist list",
    "wa-pro config allowlist add +4917600000001",
    "wa-pro config allowlist add 120363406173840067@g.us --account michael",
    "wa-pro config allowlist remove +4917600000001",
    "wa-pro config allowlist clear",
    "wa-pro config allowlist --reset --account michael",
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
    account: Flags.string({ description: "Apply to this account (otherwise global)" }),
    reset: Flags.boolean({ description: "Remove per-account override (fall back to global)", default: false }),
    db: Flags.string({ env: "WA_PRO_DB", description: "Path to observer SQLite database" }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ConfigAllowlist);
    const dbPath = resolveDbPath(flags.db);
    const db = await openDb(dbPath);
    const key = "filters.allowlist";

    try {
      if (flags.reset && flags.account) {
        db.resetAccount(flags.account, key);
        db.flush();
        process.stdout.write(`Reset allowlist for account ${flags.account} (using global default).\n`);
        return;
      }

      const settings = flags.account
        ? db.getAccountSettings(flags.account)
        : db.getObserverSettings();
      const current = [...settings.filters.allowlist];

      const save = (list: string[]) => {
        const value = JSON.stringify(list);
        if (flags.account) {
          db.setAccount(flags.account, key, value);
        } else {
          db.setGlobal(key, value);
        }
        db.flush();
      };

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
            const updated = current.filter((e) => e !== "*");
            updated.push(args.entry);
            save(updated);
            process.stdout.write(`Added: ${args.entry}\n`);
          } else {
            process.stdout.write(`Already in allowlist: ${args.entry}\n`);
          }
          break;

        case "remove":
          if (!args.entry) {
            this.error("Entry is required for 'remove' action");
          }
          save(current.filter((e) => e !== args.entry));
          process.stdout.write(`Removed: ${args.entry}\n`);
          break;

        case "clear":
          save([]);
          process.stdout.write("Allowlist cleared.\n");
          break;
      }
    } finally {
      db.close();
    }
  }
}
