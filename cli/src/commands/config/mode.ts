import { Args, Command, Flags } from "@oclif/core";
import { resolveDbPath, openDb } from "../../lib/db-reader.js";
import { OBSERVER_MODES, type ObserverMode } from "../../../../src/observer/types.js";

export default class ConfigMode extends Command {
  static override description = "Get or set the observer recording/retrieval mode";

  static override examples = [
    "wa-pro config mode",
    "wa-pro config mode record-all-retrieve-all",
    "wa-pro config mode record-all-retrieve-filtered",
    "wa-pro config mode record-filtered-retrieve-filtered",
  ];

  static override args = {
    mode: Args.string({
      required: false,
      description: "New mode to set",
      options: [...OBSERVER_MODES],
    }),
  };

  static override flags = {
    db: Flags.string({ env: "WA_PRO_DB", description: "Path to observer SQLite database" }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ConfigMode);
    const dbPath = resolveDbPath(flags.db);
    const db = await openDb(dbPath);

    try {
      if (args.mode) {
        db.setSetting("mode", args.mode);
        db.flush();
        process.stdout.write(`Mode set to: ${args.mode}\n`);
      } else {
        const settings = db.getObserverSettings();
        process.stdout.write(`${settings.mode}\n`);
      }
    } finally {
      db.close();
    }
  }
}
