import type { loadConfig } from "openclaw/plugin-sdk/config-runtime";
import {
  resolveChannelGroupPolicy,
  resolveChannelGroupRequireMention,
} from "openclaw/plugin-sdk/config-runtime";
import {
  loadSessionStore,
  resolveGroupSessionKey,
  resolveStorePath,
} from "openclaw/plugin-sdk/config-runtime";
import { normalizeGroupActivation } from "openclaw/plugin-sdk/reply-runtime";
import { getChannelConfig } from "../../channel-config.js";

export function resolveGroupPolicyFor(cfg: ReturnType<typeof loadConfig>, conversationId: string) {
  const groupId = resolveGroupSessionKey({
    From: conversationId,
    ChatType: "group",
    Provider: "whatsapp-pro",
  })?.id;
  const whatsappCfg = getChannelConfig(cfg);
  const hasGroupAllowFrom = Boolean(
    whatsappCfg?.groupAllowFrom?.length || whatsappCfg?.allowFrom?.length,
  );
  return resolveChannelGroupPolicy({
    cfg,
    channel: "whatsapp-pro",
    groupId: groupId ?? conversationId,
    hasGroupAllowFrom,
  });
}

export function resolveGroupRequireMentionFor(
  cfg: ReturnType<typeof loadConfig>,
  conversationId: string,
) {
  const groupId = resolveGroupSessionKey({
    From: conversationId,
    ChatType: "group",
    Provider: "whatsapp-pro",
  })?.id;
  return resolveChannelGroupRequireMention({
    cfg,
    channel: "whatsapp-pro",
    groupId: groupId ?? conversationId,
  });
}

export function resolveGroupActivationFor(params: {
  cfg: ReturnType<typeof loadConfig>;
  agentId: string;
  sessionKey: string;
  conversationId: string;
}) {
  const storePath = resolveStorePath(params.cfg.session?.store, {
    agentId: params.agentId,
  });
  const store = loadSessionStore(storePath);
  const entry = store[params.sessionKey];
  const requireMention = resolveGroupRequireMentionFor(params.cfg, params.conversationId);
  const defaultActivation = !requireMention ? "always" : "mention";
  return normalizeGroupActivation(entry?.groupActivation) ?? defaultActivation;
}
