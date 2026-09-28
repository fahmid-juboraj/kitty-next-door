# Kitty Next Door Live

The real-time version of the browser extension, for **Chrome, Edge and Firefox**. Your cat actually leaves your screen, walks onto a friend's screen within a second or two, and comes back later. Friends add each other once with a short friend code; after that, sending your cat is one click.

The link-based extension in the parent folder is unchanged and still works on its own. Load only one of the two in the same browser. If both are installed, the Live one steps aside so you don't get two cats.

## How it works

```
realtime/
  shared/protocol.ts     Messages + one validator used by both server and extension
  server/                Cloudflare Worker + one Durable Object per user
    src/core.ts          All the rules (friends, visits, limits), no Cloudflare code, unit-tested in Node
    src/user.ts          Durable Object: WebSockets (hibernation), storage, alarms, RPC between users
    src/index.ts         Router: /v1/connect/<FRIENDCODE>
  extension/             Chrome/Edge/Firefox extension (reuses the cat from ../src)
    src/background.ts    The one live connection per browser
    src/content.ts       Your cat and visiting cats on every page
    src/popup.*          Friend code, friends, send/call home, visitors, settings
    build.mjs            -> extension/dist/{chrome,edge,firefox} + store zips
  tests/                 Unit, live-server, background and on-page tests
  PRIVACY.md             What's sent to the server (included in every package)
```

**Rules the server enforces:**
- A cat is always in exactly one place. The owner's record decides where, and every way home goes through it: calling it home, the host sending it home, the visit timer (2 hours), or unfriending.
- Only mutual friends can send a cat to you.
- Limits: 50 friends, 20 pending requests, 3 visiting cats per host, 10 friend requests and 20 sends per hour.
- Every message is size-capped and validated on both ends, and names and notes are always shown as plain text.
- If your friend is offline, your cat waits and walks in when they next open their browser.

**What goes over the network:** only names, coats, friend lists and visit notes. See [PRIVACY.md](PRIVACY.md). Popup → Settings → **Delete my account** erases your server record.

## Try it locally (no Cloudflare account needed)

```sh
cd realtime/server && npm install          # once
npm run dev                                 # local server on ws://127.0.0.1:8787
# in another terminal, from realtime/
npm run build                               # extension built for the local server
```

Then load it:
- **Chrome/Edge:** open `chrome://extensions` (or `edge://extensions`), turn on Developer mode, click **Load unpacked** and pick `realtime/extension/dist/chrome` (or `.../edge`).
- **Firefox:** open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on** and pick `realtime/extension/dist/firefox/manifest.json`.

To see two cats visit each other on one computer, use two browsers (say Chrome and Firefox) or two Chrome profiles. Copy one's friend code from the popup, add it in the other, accept, and click **Send**.

## Tests

| Command (from `realtime/`) | What it checks |
|---|---|
| `npm run typecheck` | Extension, shared code and server |
| `npm test` | 24 unit tests: server rules, including races, offline hosts, full hosts, unfriend mid-visit and account deletion; message validation |
| `npm run test:live` | Real local Cloudflare runtime: sign-in, bad tokens, junk frames, friends, real-time moves, the visit timer, offline delivery, delete. Needs `npm run server` running, started with `--var STAY_SECONDS:4` |
| `node --test tests/background.test.mjs` | Two copies of the built background script talking through the local server |
| `node scripts/run.mjs realtime/tests/content-harness.cjs` (from repo root) | On-page behavior: your cat walks off and back, visitors arrive and leave, toasts, no double cats |

## Going live on Cloudflare (free)

Run these yourself, in your own terminal. Never paste Cloudflare tokens into a chat.

```sh
cd realtime/server
npx wrangler login        # opens the browser to sign in to your free Cloudflare account
npx wrangler deploy       # prints your URL, like https://kitty-next-door-live.<you>.workers.dev
```

Then build the extension for that server (use `wss://` with the same host):

```sh
cd realtime
KITTY_SERVER=wss://kitty-next-door-live.<you>.workers.dev npm run build
# PowerShell: $env:KITTY_SERVER="wss://..."; npm run build
```

The store zips are in `extension/dist/`. Chrome Web Store charges a one-time $5 fee; Edge Add-ons and Firefox Add-ons are free. The stores ask for a privacy policy, so link [PRIVACY.md](PRIVACY.md) once it's online.

### Cost
- The Workers Free plan includes Durable Objects (SQLite storage) and 100,000 requests a day.
- A user who isn't doing anything costs almost nothing:
  - The server object "hibernates" between messages.
  - Keep-alive pings are answered automatically without waking it. Cloudflare's docs say these replies have no duration charges.
  - The extension disconnects while you're idle or your screen is locked.
- **Not measurable locally:** Cloudflare doesn't document whether those automatic ping replies count toward the 100k daily requests. Check the Workers dashboard after launch.
  - Worst case, if they count at the documented WebSocket rate (20 messages = 1 request), each user who stays connected all day uses about 216 requests. The free tier would then cover roughly 450 people online all day at once, and many more normal users.
  - Past that, Cloudflare's paid Workers plan starts at $5/month.
