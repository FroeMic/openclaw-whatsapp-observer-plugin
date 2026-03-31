import {
  applyAccountNameToChannelSection,
  type ChannelSetupAdapter,
  migrateBaseNameToDefaultAccount,
  normalizeAccountId,
} from "openclaw/plugin-sdk/setup";
import { getChannelConfig } from "./channel-config.js";

const channel = "whatsapp-pro" as const;

export const whatsappSetupAdapter: ChannelSetupAdapter = {
  resolveAccountId: ({ accountId }) => normalizeAccountId(accountId),
  applyAccountName: ({ cfg, accountId, name }) =>
    applyAccountNameToChannelSection({
      cfg,
      channelKey: channel,
      accountId,
      name,
      alwaysUseAccounts: true,
    }),
  applyAccountConfig: ({ cfg, accountId, input }) => {
    const namedConfig = applyAccountNameToChannelSection({
      cfg,
      channelKey: channel,
      accountId,
      name: input.name,
      alwaysUseAccounts: true,
    });
    const next = migrateBaseNameToDefaultAccount({
      cfg: namedConfig,
      channelKey: channel,
      alwaysUseAccounts: true,
    });
    const channelCfg = getChannelConfig(next);
    const entry = {
      ...channelCfg?.accounts?.[accountId],
      ...(input.authDir ? { authDir: input.authDir } : {}),
      enabled: true,
    };
    return {
      ...next,
      channels: {
        ...next.channels,
        "whatsapp-pro": {
          ...channelCfg,
          accounts: {
            ...channelCfg?.accounts,
            [accountId]: entry,
          },
        },
      },
    };
  },
};
