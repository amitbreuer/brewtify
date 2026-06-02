export interface TapConfig {
  botToken: string;
  adminChatId: string;
  enabled: boolean;
}

export function loadConfig(): TapConfig {
  const botToken = process.env.TAP_BOT_TOKEN || '';
  const adminChatId = process.env.TAP_ADMIN_CHAT_ID || '';
  const enabled = process.env.TAP_ENABLED !== 'false' && !!botToken && !!adminChatId;

  return { botToken, adminChatId, enabled };
}
