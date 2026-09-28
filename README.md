# Kitty Next Door

A small cat that lives on your desktop and keeps you company. It naps and wanders along the top of your taskbar. Sometimes it sits and watches you, and it's happy to see you when you come back.

![Your cat and a visiting friend's cat sitting together in a browser window](art/hero.png)

**Website:** https://kitty-next-door.kittynextdoor.workers.dev

## Install

Store listings are on the way. Until then, every version installs from this repo's [latest release](https://github.com/fahmid-juboraj/kitty-next-door/releases/latest).

### Install on Chrome
1. Download `kitty-next-door-live-chrome-<version>.zip` from the [latest release](https://github.com/fahmid-juboraj/kitty-next-door/releases/latest) and unzip it.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the unzipped folder.
4. Click the puzzle-piece icon, then pin **Kitty Next Door Live**. Your friend code is in its popup.

### Install on Microsoft Edge
1. Download `kitty-next-door-live-edge-<version>.zip` from the [latest release](https://github.com/fahmid-juboraj/kitty-next-door/releases/latest) and unzip it.
2. Open `edge://extensions` and turn on **Developer mode** (left side).
3. Click **Load unpacked** and choose the unzipped folder.

### Install on Firefox
1. Download `kitty-next-door-live-firefox-<version>.zip` from the [latest release](https://github.com/fahmid-juboraj/kitty-next-door/releases/latest).
2. Open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on** and choose the zip. Firefox 140 or newer is needed.
3. Firefox removes temporary add-ons when it restarts. The permanent version arrives with the Firefox Add-ons listing.

### Install the Windows app
1. Download `Kitty-Next-Door-Setup-<version>.exe` (installer) or `Kitty-Next-Door-Portable-<version>.exe` (no install) from the [latest release](https://github.com/fahmid-juboraj/kitty-next-door/releases/latest).
2. The app isn't code-signed yet, so Windows shows "Windows protected your PC". Click **More info → Run anyway**.
3. The cat appears at the bottom of your screen. Use the tray icon to hide it, start it with Windows, or quit.

Use just one browser extension per browser: either **Kitty Next Door Live** (real-time visits, recommended) or the link-based **Kitty Next Door**.

## Browser extension (Chrome, Edge, Firefox)

The same cat lives at the bottom of your web pages. It remembers where it was and how it's feeling across tabs, and it pauses in background tabs. Clicks pass through to the page everywhere except on the cat.

**Send your cat to visit a friend:** open the toolbar popup, add a note and a gift, and click **Copy visit link**.
- If your friend doesn't have the extension, your cat walks onto the link's page and delivers your note.
- If they do, they click **Let them stay**. Your cat then lives on their screen next to their own cat for a day, and walks home afterwards.

The visit travels inside the link and is never sent to a server.

To try it locally, run `npm run build:ext`, then:
- **Chrome/Edge:** open `chrome://extensions`, turn on Developer mode, click **Load unpacked** and pick `dist-ext/chrome`.
- **Firefox:** open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on** and pick `dist-ext/firefox/manifest.json`.

Store zips are written to `dist-ext/*.zip`. Visit links point at `https://kitty-next-door.kittynextdoor.workers.dev/visit/`. That landing site is served by the same Cloudflare Worker as the live server (see `realtime/README.md`). Set `KITTY_VISIT_BASE` when building to use another address.

## Run from source

```sh
npm install
npm start               # the cat appears at the bottom of your primary screen
npm start -- --demo     # short timers, for recording videos (see below)
npm run dist:win        # builds the installer and portable exe into release/
```

Hide, show or quit from the tray icon. You can also right-click the cat to quit. The cat stays on top of everything, including fullscreen video and screen shares, so hide it before presenting.

Turn on **Start with Windows** in the tray menu so your cat is there every morning.

Other scripts:

| Script | What it does |
|---|---|
| `npm run gallery` | Renders every pose and coat to `art/gallery.png` and regenerates the icons in `assets/` |
| `npm run selftest` | Runs the real overlay off-screen, saves frames to `art/selftest-*.png` and prints memory and CPU use |
| `npm run typecheck` | Type-checks the whole project |
| `npm run build:ext` | Builds the browser extensions, their store zips and the visit landing site (`dist-site/`) |
| `npm test` | Unit tests for visit links, including malformed and malicious input |
| `npm run test:ext` | Off-screen end-to-end test of the extension: landing page, accepting a visit, the guest on other pages, and the guest leaving |

## What the cat does

- **Watches you.** Its eyes follow your cursor anywhere on screen. If you stay behind it, it turns around to look at you.
- **Slow-blinks** when you hold the cursor still near it. In cat language this means "I trust you".
- **Lives its own life.** It walks, sits, loafs and naps depending on its energy. It gets sleepier at night, and sometimes wanders over to where you are.
- **Notices when you're away.** After 2 minutes without input it curls up and sleeps. When you come back it wakes, looks at you, slow-blinks and walks over.
- **Petting:** rub the cursor back and forth over it and it purrs and shows hearts.
- **Boop:** click it for a little "mrrp".
- **Pick it up:** drag it and it hangs by the scruff, looking unimpressed. Let go and it drops, lands with a thump and sits looking offended.

Clicks pass straight through everything except the cat itself, and clicking the cat doesn't take focus from the app you're using.

**Privacy:** the cat only reads cursor position and system idle time. It never records keystrokes and makes no network requests.

## Recording a demo

`--demo` makes the cat treat you as "away" after 10 seconds instead of 2 minutes, and makes it slow-blink more readily. Record with **Win+Alt+R** (Xbox Game Bar) or OBS. Moments worth catching:
- **Welcome back:** stay still for 10 seconds until it falls asleep, then move the mouse. It wakes up, looks at you, slow-blinks and walks over.
- **Petting:** rub the cursor over it.
- **Pick-up:** drag it up and let go.

## How it's built

![All poses and coats](art/gallery.png)

```
src/core/      Pure TypeScript: no DOM, no Electron
  pose.ts      Poses as blendable numbers (the "rig")
  draw.ts      Draws the cat on a 2D canvas from a pose
  coats.ts     Color palettes (ginger, grey tabby, cream, black)
  brain.ts     Behavior: activities, energy, attention, petting, greeting
src/main/      Electron shell: transparent overlay, click-through, cursor and idle polling, tray
src/renderer/  Connects the shell to the core; gallery.ts renders the review sheet
```

- **The art is drawn in code.** There are no image files, so it stays small, keeps a clean license for open source, and lets the eyes, breathing and coat colors be fully dynamic.
- **The core has no dependency on the shell.** The Electron layer only supplies cursor position, idle time and screen size. That keeps moving to Tauri and adding friend visits cheap.

### Why Electron, not Tauri (yet)

Tauri uses far less memory, but it needs Rust plus the Microsoft C++ Build Tools, which weren't installed on the dev machine. On Electron the overlay currently uses about 300 MB of RAM. To switch later:

1. Install the "Desktop development with C++" workload from the [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/).
2. Run `winget install --id Rustlang.Rustup`, then `rustup default stable-msvc`.
3. Replace `src/main/` with a Tauri shell. `src/core/` stays unchanged.

## Roadmap

- [x] **M1**: transparent overlay, click-through, walking and idling on the taskbar, eyes follow the cursor, code-drawn art. Tested on a Windows 11 desktop at 125% scaling: transparent background, always on top, click-through away from the cat, no focus stealing.
- [x] (early) petting, boop, and pick up and drop, all tested on the desktop. Slow blink and greeting when you return are implemented but not yet seen live.
- [ ] Manual check still needed: tray Hide/Show/Quit, right-click Quit, no taskbar button or Alt+Tab entry
- [ ] **M4**: hide during fullscreen apps, meetings and presentations; multi-monitor; sitting on top of windows
- [ ] **M5**: memory (days together, morning greeting), settings (coat, size, sounds), signed installer
- [ ] More life: grooming, stretching, chasing the cursor, reacting to music
- [x] Friend visits (browser extension): a visit link brings your cat to a friend's screen for a day
- [ ] Friend visits on the desktop app

## License

Kitty Next Door is **source-available** under the [PolyForm Noncommercial License 1.0.0](LICENSE). You're free to use it, study it, modify it and share it for any noncommercial purpose. Any copy must keep the credit line at the top of the LICENSE. Commercial use needs permission from the author, so open an issue to ask.
