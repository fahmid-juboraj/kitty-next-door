# Building Kitty Next Door Live from source

These instructions reproduce the published extension packages (Firefox, Chrome and Edge) exactly.

## Requirements
- Any OS (tested on Windows 11; also works on Ubuntu 24.04 LTS)
- Node.js 22 or newer (https://nodejs.org), which includes npm
- No other tools. The only build dependency is esbuild, pinned in `package-lock.json`.

## Build
From the folder that contains this source package's `package.json`:

```sh
npm ci
npm run build
```

The output goes to `realtime/extension/dist/`:
- `firefox/`, `chrome/`, `edge/`: the unpacked extensions
- `kitty-next-door-live-{firefox,chrome,edge}-<version>.zip`: the packages that were submitted

`npm run build` runs `node realtime/extension/build.mjs --prod`. The script bundles each TypeScript entry point (`background.ts`, `content.ts` and `popup.ts` in `realtime/extension/src/`) into one plain, unminified JavaScript file with esbuild. It then copies `popup.html`, the icons, `LICENSE` and `PRIVACY.md`, and writes `manifest.json`.

## What's in the source
- `realtime/extension/`: the extension (background connection, on-page cats, popup) and its build script
- `realtime/shared/protocol.ts`: messages between the extension and the server, and their validation
- `src/core/`, `src/web/`, `src/ext/`: the cat itself (behavior, pose rig, drawing, coats) and shared helpers
- `assets/`: icons

There is no minification, obfuscation or remote code. The server the extension connects to (`wss://kitty-next-door.kittynextdoor.workers.dev`) only exchanges JSON messages. Its source is in the public repository: https://github.com/fahmid-juboraj/kitty-next-door
