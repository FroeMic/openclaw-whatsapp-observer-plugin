export type ObserverConfig = {
  dbPath: string;
  mediaPath: string;
  filters: ObserverFilters;
  retentionDays: number;
  observerAccounts: string[];
};

export type ObserverFilters = {
  blocklist: string[];
  allowlist: string[];
};

export type MessageType = "message" | "reaction" | "poll" | "edit" | "delete";
export type MessageSource = "observer" | "pipeline";

export type ObserverMessage = {
  messageId?: string;
  accountId: string;
  sender: string;
  senderName?: string;
  senderE164?: string;
  conversationId: string;
  isGroup: boolean;
  groupId?: string;
  groupName?: string;
  content?: string;
  mediaType?: string;
  mediaPath?: string;
  mediaMime?: string;
  timestamp: number;
  messageType?: MessageType;
  refMessageId?: string;
  source?: MessageSource;
};

export type ObserverStats = {
  totalMessages: number;
  uniqueSenders: number;
  uniqueConversations: number;
  firstMessageAt: number | null;
  lastMessageAt: number | null;
};

export type ConversationSummary = {
  conversationId: string;
  groupName?: string;
  messageCount: number;
  lastMessageAt: number;
  lastSender?: string;
};

export type StatsGroupByResult = {
  key: string;
  count: number;
};

export type ChannelLogSink = {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
  debug?: (msg: string) => void;
};
