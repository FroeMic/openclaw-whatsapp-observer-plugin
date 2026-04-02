import { Args, Command, Flags } from "@oclif/core";
import { resolveDbPath, openDb } from "../../lib/db-reader.js";

export default class ConfigBlocklist extends Command {
  static override description = "Manage the observer blocklist (block messages from specific senders/groups)";

  static override examples = [
    "wa-pro config blocklist list",
    "wa-pro config blocklist add +4917600000001",
    "wa-pro config blocklist add 120363406173840067@g.us --account michael",
    "wa-pro config blocklist remove +4917600000001",
    "wa-pro config blocklist clear",
    "wa-pro config blocklist --reset --account michael",
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
    const { args, flags } = await this.parse(ConfigBlocklist);
    const dbPath = resolveDbPath(flags.db);
    const db = await openDb(dbPath);
    const key = "filters.blocklist";

    try {
      if (flags.reset && flags.account) {
        db.resetAccount(flags.account, key);
        db.flush();
        process.stdout.write(`Reset blocklist for account ${flags.account} (using global default).\n`);
        return;
      }

      const settings = flags.account
        ? db.getAccountSettings(flags.account)
        : db.getObserverSettings();
      const current = [...settings.filters.blocklist];

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
            current.push(args.entry);
            save(current);
            process.stdout.write(`Added: ${args.entry}\n`);
          } else {
            process.stdout.write(`Already in blocklist: ${args.entry}\n`);
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
          process.stdout.write("Blocklist cleared.\n");
          break;
      }
    } finally {
      db.close();
    }
  }
}
