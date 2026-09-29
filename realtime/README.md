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

From `realtime/`:

```sh
npm --prefix server install     # once
npm run server                  # local server on ws://127.0.0.1:8787 (leave it running)
npm run build                   # in a second terminal: extension built for the local server
```

Then load it:
- **Chrome/Edge:** open `chrome://extensions` (or `edge://extensions`), turn on Developer mode, click **Load unpacked** and pick `realtime/extension/dist/chrome` (or `.../edge`).
- **Firefox:** open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on** and pick `realtime/extension/dist/firefox/manifest.json`.

Remove or turn off the link-based Kitty Next Door extension in the same browser first. Otherwise the Live one steps aside and you won't see its cat.

To watch two cats visit each other on one computer, use two browsers (say Chrome and Firefox) or two Chrome profiles. Copy one's friend code from the popup, add it in the other, accept, and click **Send**.

## Tests

From `realtime/`. The last three need the local server running as `npm run server:test`, which sets a 4-second visit so the timer is quick to test.

| Command | What it checks |
|---|---|
| `npm run typecheck` | Extension, shared code and server |
| `npm test` | 25 unit tests: the server rules, including races, offline hosts, full hosts, unfriending mid-visit, and deleting an account at the 50-friend cap; message validation |
| `npm run test:live` | The real local Cloudflare runtime: sign-in, bad tokens, junk frames, friends, real-time moves, the visit timer, offline delivery, delete |
| `npm run test:bg` | Builds, then runs two copies of the real background script talking through the local server. Includes "a deleted account stays deleted" |
| `npm run test:page` | Builds, then checks the page (your cat walks off and back, visitors come and go, toasts, no double cats) and every popup button |

## Live deployment

The Worker is deployed at **https://kitty-next-door.kittynextdoor.workers.dev**. One Worker serves:
- the landing site: `/` and `/visit/` (the static files in `../dist-site`, built by `npm run build:ext` in the repo root);
- the live server: `wss://kitty-next-door.kittynextdoor.workers.dev/v1/connect/<FRIENDCODE>`.

To redeploy after changes, sign in once with `npx wrangler login` in your own terminal, then run this from `realtime/`:

```sh
npm run deploy          # builds the site, then deploys site + server together
npm run build:prod      # extension packages for the live server -> extension/dist/*.zip
node tests/smoke.mjs    # end-to-end check against the live server; cleans up after itself
```

Always deploy from `realtime/` (or `realtime/server/`). Running `wrangler deploy` in the repo root makes Wrangler invent its own config and publish the wrong folder.

Chrome Web Store charges a one-time $5 fee; Edge Add-ons and Firefox Add-ons are free. The stores ask for a privacy policy, so link [PRIVACY.md](PRIVACY.md) once the code is on GitHub.

### Download badges
`/badge/<installs|downloads|chrome|edge|firefox|windows>.json` serves live counts in shields.io's endpoint format. They come from GitHub release downloads, cached for 10 minutes, and from the Firefox add-on's daily users via the public addons.mozilla.org API (`AMO_SLUG` in `wrangler.toml`). Edge and Chrome have no public API. Copy their weekly users from the store dashboards into `EDGE_USERS` and `CHROME_USERS` in `wrangler.toml`, then `npm run deploy`. For higher GitHub API limits, optionally add a token: `npx wrangler secret put GITHUB_TOKEN`.

### Cost
- The Workers Free plan includes Durable Objects (SQLite storage) and 100,000 requests a day.
- A user who isn't doing anything costs almost nothing:
  - The server object "hibernates" between messages.
  - Keep-alive pings are answered automatically without waking it. Cloudflare's docs say these replies have no duration charges.
  - The extension disconnects while you're idle or your screen is locked.
- **Not measurable locally:** Cloudflare doesn't document whether those automatic ping replies count toward the 100k daily requests. Check the Workers dashboard after launch.
  - Worst case, if they count at the documented WebSocket rate (20 messages = 1 request), each user who stays connected all day uses about 216 requests. The free tier would then cover roughly 450 people online all day at once, and many more normal users.
  - Past that, Cloudflare's paid Workers plan starts at $5/month.
