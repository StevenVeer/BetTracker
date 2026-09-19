import { TelegramClient } from 'teleproto';
import { StringSession } from 'teleproto/sessions/index.js';
import { NewMessage } from 'teleproto/events/index.js';

// Luistert live mee in één Telegram-groep met het account dat via
// telegram-login.js is ingelogd (TELEGRAM_SESSION). Ontbreekt de config, dan
// laat de app het gewoon zonder Telegram-ingestie draaien - geen harde
// afhankelijkheid, zodat de rest van de tracker altijd blijft werken.
export async function startTelegramListener(onMessage) {
  const apiId = Number(process.env.TELEGRAM_API_ID);
  const apiHash = process.env.TELEGRAM_API_HASH;
  const sessionString = process.env.TELEGRAM_SESSION;
  const groupId = process.env.TELEGRAM_GROUP_ID;

  if (!apiId || !apiHash || !sessionString || !groupId) {
    console.log('[telegram] niet volledig geconfigureerd (TELEGRAM_API_ID/API_HASH/SESSION/GROUP_ID) - ingestie staat uit.');
    return null;
  }

  const client = new TelegramClient(new StringSession(sessionString), apiId, apiHash, { connectionRetries: 5 });
  await client.connect();

  client.addEventHandler(async (event) => {
    const message = event.message;
    if (!message?.message) return; // media-only bericht zonder tekst, niets te parsen
    try {
      await onMessage({
        chatId: String(groupId),
        messageId: String(message.id),
        text: message.message,
        postedAt: new Date(message.date * 1000),
      });
    } catch (error) {
      console.error('[telegram] kon bericht niet verwerken:', error.message);
    }
  }, new NewMessage({ chats: [groupId] }));

  console.log(`[telegram] luistert mee in groep ${groupId}`);
  return client;
}

// Eenmalig oudere berichten ophalen (bv. om de tracker vanaf gisteren gelijk
// te laten lopen met de eigen bets), los van de live listener. reverse:true
// + offsetDate haalt op vanaf die datum in chronologische volgorde.
export async function backfillMessages(client, groupId, sinceDate, onMessage) {
  const since = new Date(sinceDate);
  console.log(`[telegram] backfill: ophalen sinds ${since.toISOString()}...`);
  const messages = await client.getMessages(groupId, {
    offsetDate: Math.floor(since.getTime() / 1000),
    reverse: true,
    limit: 500,
  });
  console.log(`[telegram] backfill: ${messages.length} bericht(en) gevonden, verwerken...`);
  let processed = 0;
  for (const message of messages) {
    if (!message?.message) continue;
    const preview = message.message.replace(/\s+/g, ' ').trim().slice(0, 70);
    console.log(`[telegram] backfill: bericht ${message.id} van ${new Date(message.date * 1000).toISOString()} - "${preview}${preview.length < message.message.trim().length ? '…' : ''}"`);
    await onMessage({
      chatId: String(groupId),
      messageId: String(message.id),
      text: message.message,
      postedAt: new Date(message.date * 1000),
    });
    processed += 1;
  }
  console.log(`[telegram] backfill: klaar, ${processed} bericht(en) met tekst verwerkt`);
  return processed;
}
