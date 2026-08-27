import { EventMesh, TOPICS } from '@aegis/shared';
import dotenv from 'dotenv';

dotenv.config();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? '';
const CHAT_ID = process.env.TELEGRAM_CHAT_ID ?? '';
const REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';

// Telegram publishes process/health alerts for the OPERATOR's own system only.
// It is not used to report third-party wallet activity.
const alertClass = {
  [TOPICS.SCAN_COMPLETED]: 'ALPHA',
  [TOPICS.RELAY_CONFIRMED]: 'BRAVO',
  [TOPICS.RELAY_FAILURE]: 'BRAVO',
  [TOPICS.COMPILE_GENERATED]: 'CHARLIE',
  [TOPICS.CAMPAIGN_DEPLOYED]: 'ECHO',
};

async function sendText(text) {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.log('[telegram] (disabled) would send:', text);
    return false;
  }
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text, disable_web_page_preview: true }),
  });
  if (!res.ok) console.error('[telegram] send failed', await res.text());
  return res.ok;
}

function format(topic, data) {
  const tag = alertClass[topic] ?? 'INFO';
  const ts = data?.ts ?? new Date().toISOString();
  return `[${tag}] ${topic} — ${JSON.stringify(data)} @ ${ts}`;
}

const mesh = new EventMesh(REDIS_URL);

async function handle(topic) {
  mesh.subscribe(topic, async (data) => {
    const msg = format(topic, data);
    await sendText(msg);
    console.log('[telegram]', msg);
  });
}

await handle(TOPICS.SCAN_COMPLETED);
await handle(TOPICS.RELAY_CONFIRMED);
await handle(TOPICS.RELAY_FAILURE);
await handle(TOPICS.COMPILE_GENERATED);
await handle(TOPICS.CAMPAIGN_DEPLOYED);

console.log('[telegram] monitoring operator-only events');