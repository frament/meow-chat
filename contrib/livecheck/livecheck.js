// Live check for the client -> server encryption layer.
//
// What it proves, and why it cannot be proven by a unit test: one browser sends a
// text message, another browser - a different context, so a different device with
// its own account key - must show that text **without reloading the thread**. The
// reload path (GET /api/messages) has always wrapped the text for the reader; the
// socket path did not, and a sealed message arrived as an empty bubble
// (2026-10-25, fixed 2026-11-03). So the check also asserts that the recipient
// fetched nothing after the send: if the text came back through a periodic GET,
// nothing about the socket was tested.
//
// Requirements, all of them:
//   - a backend with `MEOWCHAT_ATREST_KEY` set and its own database;
//   - a frontend built with `PINNED_SERVER_KEY_FINGERPRINT` equal to that
//     backend's fingerprint (`GET /api/crypto/server-key`). Without the pin the
//     layer is off by design and this check tests the old path instead. Revert
//     the constant afterwards: it belongs to a deployment, not to the repository;
//   - two accounts that can see each other in the list.
//
// Usage:
//   npm install            # playwright-core only, it drives the installed Chrome
//   APP=http://localhost:4200 SENDER=a RECIPIENT=b SENDER_ID=2 RECIPIENT_ID=3 \
//     PASSWORD=secret node livecheck.js
//
// Exit code 0 means the recipient saw the text live. Anything else prints why.
const { chromium } = require('playwright-core');

const APP = process.env.APP || 'http://localhost:4200';
const SENDER = process.env.SENDER || 'sender';
const RECIPIENT = process.env.RECIPIENT || 'recipient';
const SENDER_ID = process.env.SENDER_ID || '2';
const RECIPIENT_ID = process.env.RECIPIENT_ID || '3';
const PASSWORD = process.env.PASSWORD || '';
const TEXT = process.env.TEXT || 'проверка запечатанного сообщения';

async function login(browser, username) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${APP}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[name="username"]', username);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  // Waiting for the account key can take a moment on the first sign-in: it is
  // created and registered here, with the password at hand.
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60000 });
  return page;
}

(async () => {
  if (!PASSWORD) throw new Error('PASSWORD is required');

  const browser = await chromium.launch({ channel: 'chrome', headless: true });

  const sender = await login(browser, SENDER);
  const recipient = await login(browser, RECIPIENT);

  // The recipient opens the thread first: the socket handler only fills the thread
  // that is currently open, which is how a live bubble can differ from a reload.
  await recipient.goto(`${APP}/chat/${SENDER_ID}`, { waitUntil: 'networkidle' });
  await recipient.waitForSelector('.chat-composer-input', { timeout: 30000 });

  await sender.goto(`${APP}/chat/${RECIPIENT_ID}`, { waitUntil: 'networkidle' });
  await sender.waitForSelector('.chat-composer-input', { timeout: 30000 });

  const fetches = [];
  const failures = [];
  recipient.on('request', (r) => {
    if (r.method() === 'GET' && r.url().includes('/api/messages')) {
      fetches.push(r.url());
    }
  });
  for (const page of [sender, recipient]) {
    page.on('response', (r) => {
      if (r.status() >= 400) failures.push(`${r.status()} ${r.request().method()} ${r.url()}`);
    });
  }

  fetches.length = 0;
  await sender.fill('.chat-composer-input', TEXT);
  await sender.keyboard.press('Enter');

  let seen = false;
  try {
    await recipient.waitForFunction((text) => document.body.innerText.includes(text), TEXT, {
      timeout: 20000,
    });
    seen = true;
  } catch {
    seen = false;
  }

  await sender.screenshot({ path: 'sender.png' });
  await recipient.screenshot({ path: 'recipient.png' });

  console.log('recipient saw the text live:', seen);
  console.log('recipient fetched the thread after the send:', fetches.length);
  if (failures.length) console.log('non-2xx responses:', [...new Set(failures)].join(', '));

  // The text may also be missing because the sender's own send failed; say so
  // rather than blaming the socket.
  if (!seen) {
    const own = await sender.evaluate(() => document.body.innerText);
    console.log('sender shows the text:', own.includes(TEXT));
  }

  await browser.close();
  process.exit(seen && fetches.length === 0 ? 0 : 1);
})().catch((error) => {
  console.error('FAILED:', error.message);
  process.exit(2);
});
