import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TelegramClient, Api } from 'teleproto';
import { StringSession } from 'teleproto/sessions/index.js';
import { computeCheck } from 'teleproto/Password.js';

// Eenmalige, niet-interactieve login-flow voor het user-account dat de
// Telegram-groep meeleest. Draait in twee stappen (elk een losse
// procesinvocatie), omdat de bevestigingscode pas ontstaat NADAT Telegram 'm
// naar de app heeft gestuurd - er is dus geen manier om dat in één
// doorlopend proces te doen zonder interactieve stdin. Tussenstaat
// (phoneCodeHash + tijdelijke sessie) wordt lokaal weggeschreven en na step 2
// weer opgeruimd.
//
// Gebruik:
//   node telegram-login.js send <telefoonnummer incl. landcode, bv. +31612345678>
//   node telegram-login.js confirm <code-uit-telegram> [2fa-wachtwoord]
//   node telegram-login.js list-groups   (na inloggen: chat-ID's opzoeken)

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(__dirname, '.telegram-login-state.json');
const ENV_FILE = path.join(__dirname, '..', '.env');

const apiId = Number(process.env.TELEGRAM_API_ID);
const apiHash = process.env.TELEGRAM_API_HASH;

if (!apiId || !apiHash) {
  console.error('TELEGRAM_API_ID en TELEGRAM_API_HASH moeten in .env staan (zie my.telegram.org).');
  process.exit(1);
}

async function sendCode(phone) {
  if (!phone) {
    console.error('Gebruik: node telegram-login.js send <telefoonnummer incl. landcode>');
    process.exit(1);
  }
  const client = new TelegramClient(new StringSession(''), apiId, apiHash, { connectionRetries: 5 });
  await client.connect();
  const result = await client.invoke(
    new Api.auth.SendCode({
      phoneNumber: phone,
      apiId,
      apiHash,
      settings: new Api.CodeSettings({}),
    })
  );
  fs.writeFileSync(
    STATE_FILE,
    JSON.stringify({ phone, phoneCodeHash: result.phoneCodeHash, session: client.session.save() })
  );
  console.log(`Code verstuurd naar Telegram op ${phone}.`);
  console.log('Check je Telegram-app en run daarna:');
  console.log('  node telegram-login.js confirm <code>');
  await client.disconnect();
}

async function confirmCode(code, password) {
  if (!fs.existsSync(STATE_FILE)) {
    console.error('Geen openstaande login. Run eerst: node telegram-login.js send <telefoonnummer>');
    process.exit(1);
  }
  if (!code) {
    console.error('Gebruik: node telegram-login.js confirm <code> [2fa-wachtwoord]');
    process.exit(1);
  }
  const { phone, phoneCodeHash, session } = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  const client = new TelegramClient(new StringSession(session), apiId, apiHash, { connectionRetries: 5 });
  await client.connect();

  try {
    await client.invoke(new Api.auth.SignIn({ phoneNumber: phone, phoneCodeHash, phoneCode: code }));
  } catch (error) {
    if (error.errorMessage === 'SESSION_PASSWORD_NEEDED') {
      if (!password) {
        console.error('Dit account heeft 2FA. Run: node telegram-login.js confirm <code> <2fa-wachtwoord>');
        await client.disconnect();
        process.exit(1);
      }
      const passwordInfo = await client.invoke(new Api.account.GetPassword());
      const srpCheck = await computeCheck(passwordInfo, password);
      await client.invoke(new Api.auth.CheckPassword({ password: srpCheck }));
    } else {
      await client.disconnect();
      throw error;
    }
  }

  const sessionString = client.session.save();
  fs.appendFileSync(ENV_FILE, `\nTELEGRAM_SESSION=${sessionString}\n`);
  fs.unlinkSync(STATE_FILE);
  console.log('Ingelogd! TELEGRAM_SESSION is toegevoegd aan .env.');
  console.log('Run nu "node telegram-login.js list-groups" om de chat-ID van de groep op te zoeken.');
  await client.disconnect();
  process.exit(0);
}

async function listGroups() {
  const sessionString = process.env.TELEGRAM_SESSION;
  if (!sessionString) {
    console.error('Nog geen TELEGRAM_SESSION in .env - log eerst in met "send" + "confirm".');
    process.exit(1);
  }
  const client = new TelegramClient(new StringSession(sessionString), apiId, apiHash, { connectionRetries: 5 });
  await client.connect();
  const dialogs = await client.getDialogs({ limit: 200 });
  for (const dialog of dialogs) {
    if (dialog.isGroup || dialog.isChannel) {
      console.log(`${dialog.id.toString()}\t${dialog.title}`);
    }
  }
  await client.disconnect();
  process.exit(0);
}

const [, , command, ...args] = process.argv;

try {
  if (command === 'send') {
    await sendCode(args[0]);
  } else if (command === 'confirm') {
    await confirmCode(args[0], args[1]);
  } else if (command === 'list-groups') {
    await listGroups();
  } else {
    console.log('Gebruik:');
    console.log('  node telegram-login.js send <telefoonnummer incl. landcode>');
    console.log('  node telegram-login.js confirm <code> [2fa-wachtwoord]');
    console.log('  node telegram-login.js list-groups');
    process.exit(1);
  }
} catch (error) {
  console.error('Fout:', error.errorMessage || error.message);
  process.exit(1);
}
