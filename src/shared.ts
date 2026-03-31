import { describeAccountSnapshot } from "openclaw/plugin-sdk/account-helpers";
import {
  adaptScopedAccountAccessor,
  createScopedChannelConfigAdapter,
  createScopedDmSecurityResolver,
} from "openclaw/plugin-sdk/channel-config-helpers";
import { createAllowlistProviderRouteAllowlistWarningCollector } from "openclaw/plugin-sdk/channel-policy";
import { createChannelPluginBase } from "openclaw/plugin-sdk/core";
import { createDelegatedSetupWizardProxy } from "openclaw/plugin-sdk/setup";
import {
  listWhatsAppAccountIds,
  resolveDefaultWhatsAppAccountId,
  resolveWhatsAppAccount,
  type ResolvedWhatsAppAccount,
} from "./accounts.js";
import { getChannelConfig } from "./channel-config.js";
import {
  buildChannelConfigSchema,
  formatWhatsAppConfigAllowFromEntries,
  getChatChannelMeta,
  normalizeE164,
  resolveWhatsAppGroupIntroHint,
  resolveWhatsAppGroupRequireMention,
  resolveWhatsAppGroupToolPolicy,
  WhatsAppConfigSchema,
  type ChannelPlugin,
} from "./runtime-api.js";

export const WHATSAPP_CHANNEL = "whatsapp-pro" as const;

export async function loadWhatsAppChannelRuntime() {
  return await import("./channel.runtime.js");
}

export const whatsappSetupWizardProxy = createWhatsAppSetupWizardProxy(
  async () => (await loadWhatsAppChannelRuntime()).whatsappSetupWizard,
);

const whatsappConfigAdapter = createScopedChannelConfigAdapter<ResolvedWhatsAppAccount>({
  sectionKey: WHATSAPP_CHANNEL,
  listAccountIds: listWhatsAppAccountIds,
  resolveAccount: adaptScopedAccountAccessor(resolveWhatsAppAccount),
  defaultAccountId: resolveDefaultWhatsAppAccountId,
  clearBaseFields: [],
  allowTopLevel: false,
  resolveAllowFrom: (account) => account.allowFrom,
  formatAllowFrom: (allowFrom) => formatWhatsAppConfigAllowFromEntries(allowFrom),
  resolveDefaultTo: (account) => account.defaultTo,
});

const whatsappResolveDmPolicy = createScopedDmSecurityResolver<ResolvedWhatsAppAccount>({
  channelKey: WHATSAPP_CHANNEL,
  resolvePolicy: (account) => account.dmPolicy,
  resolveAllowFrom: (account) => account.allowFrom,
  policyPathSuffix: "dmPolicy",
  normalizeEntry: (raw) => normalizeE164(raw),
});

export function createWhatsAppSetupWizardProxy(
  loadWizard: () => Promise<NonNullable<ChannelPlugin<ResolvedWhatsAppAccount>["setupWizard"]>>,
): NonNullable<ChannelPlugin<ResolvedWhatsAppAccount>["setupWizard"]> {
  return createDelegatedSetupWizardProxy({
    channel: WHATSAPP_CHANNEL,
    loadWizard,
    status: {
      configuredLabel: "linked",
      unconfiguredLabel: "not linked",
      configuredHint: "linked",
      unconfiguredHint: "not linked",
      configuredScore: 5,
      unconfiguredScore: 4,
    },
    resolveShouldPromptAccountIds: (params) =>
      (params.shouldPromptAccountIds || params.options?.promptWhatsAppAccountId) ?? false,
    credentials: [],
    delegateFinalize: true,
    disable: (cfg) => ({
      ...cfg,
      channels: {
        ...cfg.channels,
        "whatsapp-pro": {
          ...getChannelConfig(cfg),
          enabled: false,
        },
      },
    }),
    onAccountRecorded: (accountId, options) => {
      options?.onWhatsAppAccountId?.(accountId);
    },
  });
}

export function createWhatsAppPluginBase(params: {
  groups: NonNullable<ChannelPlugin<ResolvedWhatsAppAccount>["groups"]>;
  setupWizard: NonNullable<ChannelPlugin<ResolvedWhatsAppAccount>["setupWizard"]>;
  setup: NonNullable<ChannelPlugin<ResolvedWhatsAppAccount>["setup"]>;
  isConfigured: NonNullable<ChannelPlugin<ResolvedWhatsAppAccount>["config"]>["isConfigured"];
}) {
  const collectWhatsAppSecurityWarnings =
    createAllowlistProviderRouteAllowlistWarningCollector<ResolvedWhatsAppAccount>({
      providerConfigPresent: (cfg) => getChannelConfig(cfg) !== undefined,
      resolveGroupPolicy: (account) => account.groupPolicy,
      resolveRouteAllowlistConfigured: (account) =>
        Boolean(account.groups) && Object.keys(account.groups ?? {}).length > 0,
      restrictSenders: {
        surface: "WhatsApp groups",
        openScope: "any member in allowed groups",
        groupPolicyPath: "channels.whatsapp-pro.groupPolicy",
        groupAllowFromPath: "channels.whatsapp-pro.groupAllowFrom",
      },
      noRouteAllowlist: {
        surface: "WhatsApp groups",
        routeAllowlistPath: "channels.whatsapp-pro.groups",
        routeScope: "group",
        groupPolicyPath: "channels.whatsapp-pro.groupPolicy",
        groupAllowFromPath: "channels.whatsapp-pro.groupAllowFrom",
      },
    });
  const base = createChannelPluginBase({
    id: WHATSAPP_CHANNEL,
    meta: {
      ...getChatChannelMeta(WHATSAPP_CHANNEL),
      showConfigured: false,
      quickstartAllowFrom: true,
      forceAccountBinding: true,
      preferSessionLookupForAnnounceTarget: true,
    },
    setupWizard: params.setupWizard,
    capabilities: {
      chatTypes: ["direct", "group"],
      polls: true,
      reactions: true,
      media: true,
    },
    reload: { configPrefixes: ["web"], noopPrefixes: ["channels.whatsapp-pro"] },
    gatewayMethods: ["web.login.start", "web.login.wait"],
    configSchema: buildChannelConfigSchema(WhatsAppConfigSchema),
    config: {
      ...whatsappConfigAdapter,
      isEnabled: (account, cfg) => account.enabled && cfg.web?.enabled !== false,
      disabledReason: () => "disabled",
      isConfigured: params.isConfigured,
      unconfiguredReason: () => "not linked",
      describeAccount: (account) =>
        describeAccountSnapshot({
          account,
          configured: Boolean(account.authDir),
          extra: {
            linked: Boolean(account.authDir),
            dmPolicy: account.dmPolicy,
            allowFrom: account.allowFrom,
          },
        }),
    },
    security: {
      resolveDmPolicy: whatsappResolveDmPolicy,
      collectWarnings: collectWhatsAppSecurityWarnings,
    },
    setup: params.setup,
    groups: params.groups,
  });
  return {
    ...base,
    setupWizard: base.setupWizard!,
    capabilities: base.capabilities!,
    reload: base.reload!,
    gatewayMethods: base.gatewayMethods!,
    configSchema: base.configSchema!,
    config: base.config!,
    security: base.security!,
    groups: base.groups!,
  } satisfies Pick<
    ChannelPlugin<ResolvedWhatsAppAccount>,
    | "id"
    | "meta"
    | "setupWizard"
    | "capabilities"
    | "reload"
    | "gatewayMethods"
    | "configSchema"
    | "config"
    | "security"
    | "setup"
    | "groups"
  >;
}
