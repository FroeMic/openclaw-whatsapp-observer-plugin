import { buildChannelConfigSchema } from "./runtime-api.js";
import { WhatsAppProConfigSchema } from "./channel-config.js";

export const WhatsAppChannelConfigSchema = buildChannelConfigSchema(WhatsAppProConfigSchema);
