export function readConfig(overrides = {}) {
  return {
    REDIS_URL: overrides.REDIS_URL ?? process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
    DATABASE_URL:
      overrides.DATABASE_URL ??
      process.env.DATABASE_URL ??
      'postgres://aegis:aegis_dev_password@127.0.0.1:5432/aegis',
    TELEGRAM_BOT_TOKEN: overrides.TELEGRAM_BOT_TOKEN ?? process.env.TELEGRAM_BOT_TOKEN ?? '',
    TELEGRAM_CHAT_ID: overrides.TELEGRAM_CHAT_ID ?? process.env.TELEGRAM_CHAT_ID ?? '',
    PORT: overrides.PORT ?? Number(process.env.PORT ?? 4000),
  };
}