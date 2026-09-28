// Off-screen end-to-end check for the browser extension. Runs the real
// content script in hidden Electron windows with an in-memory `chrome.storage`
// shim, walks through a whole visit, saves frames, and prints a report.
//   npm run test:ext        (frames go to art/harness/)
const { app, BrowserWindow, ipcMain } = require("electron");
const { build } = require("esbuild");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.join(__dirname, "..");
const out = path.join(root, "art", "harness");
const siteVisit = path.join(root, "dist-site", "visit", "index.html");
const article = path.join(__dirname, "harness-article.html");
const visitBase = pathToFileURL(siteVisit).href;

const store = {};
const windows = new Set();
const report = [];
const check = (name, ok, detail = "") => report.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

ipcMain.on("storage-get", (e, keys) => {
  const list = keys == null ? Object.keys(store) : [].concat(keys);
  e.returnValue = JSON.parse(JSON.stringify(Object.fromEntries(list.filter((k) => k in store).map((k) => [k, store[k]]))));
});
function broadcast(changes) {
  for (const w of windows) if (!w.isDestroyed()) w.webContents.send("storage-changed", changes);
}
ipcMain.on("storage-set", (e, items) => {
  const changes = {};
  for (const [k, v] of Object.entries(items)) {
    changes[k] = { oldValue: store[k], newValue: v };
    store[k] = v;
  }
  broadcast(changes);
  e.returnValue = true;
});
ipcMain.on("storage-remove", (e, keys) => {
  const changes = {};
  for (const k of [].concat(keys)) if (k in store) { changes[k] = { oldValue: store[k] }; delete store[k]; }
  broadcast(changes);
  e.returnValue = true;
});

async function open(file, hash, withExtension, contentJs) {
  const win = new BrowserWindow({
    width: 1280, height: 800, show: false,
    webPreferences: { offscreen: true, contextIsolation: false, preload: path.join(__dirname, "ext-harness-preload.cjs") },
  });
  windows.add(win);
  await win.loadFile(file, hash ? { hash } : undefined);
  if (withExtension) await win.webContents.executeJavaScript(contentJs);
  return win;
}

const js = (win, code) => win.webContents.executeJavaScript(code);
const state = (win) => js(win, "window.__kittyTest && window.__kittyTest.state()");
async function snap(win, name) {
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(out, `${name}.png`), img.resize({ width: 960 }).toPNG());
}
async function click(win, x, y) {
  win.webContents.sendInputEvent({ type: "mouseMove", x, y });
  win.webContents.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1 });
  win.webContents.sendInputEvent({ type: "mouseUp", x, y, button: "left", clickCount: 1 });
}

async function run() {
  fs.mkdirSync(out, { recursive: true });
  const bundle = await build({
    entryPoints: [path.join(root, "src/ext/content.ts")], bundle: true, format: "iife", write: false,
    define: { __VISIT_BASE__: JSON.stringify(visitBase) }, logLevel: "warning",
  });
  const contentJs = bundle.outputFiles[0].text;
  const visit = { v: 1, name: "Kiki", coat: "black", from: "Sam", msg: "Thinking of you! <b>hi</b>", gift: "yarn" };
  const hash = "#visit=" + Buffer.from(JSON.stringify(visit)).toString("base64url");

  // 1. A friend without the extension opens the link.
  const plain = await open(siteVisit, hash.slice(1), false);
  await wait(4500);
  const title = await js(plain, "document.getElementById('title').textContent + ' | ' + document.getElementById('msg').textContent");
  check("landing page shows the visit without the extension", title.includes("Kiki came to visit you") && title.includes("Thinking of you!"), title);
  check("note is rendered as text, not HTML", await js(plain, "!document.querySelector('#msg b') && document.getElementById('msg').textContent.includes('<b>hi</b>')"));
  check("landing page walks the visiting cat in", await js(plain, "document.querySelectorAll('#stage canvas').length === 1"));
  await snap(plain, "1-landing-no-extension");
  plain.destroy();

  // 2. A friend with the extension opens it and accepts.
  const landing = await open(siteVisit, hash.slice(1), true, contentJs);
  await wait(1500);
  check("extension marks the landing page", await js(landing, "document.documentElement.dataset.kittyNextDoor === 'installed'"));
  check("page's own demo cat steps aside", await js(landing, "document.querySelectorAll('#stage canvas').length === 0"));
  const rect = await js(landing, "window.__kittyTest.acceptRect()");
  check("offers 'Let them stay'", !!rect);
  await snap(landing, "2-landing-offer");
  const forged = await js(landing, "(() => { const r = window.__kittyTest.acceptRect(); document.elementFromPoint(r.x + 5, r.y + 5).click(); return true; })()");
  await wait(300);
  check("a scripted (untrusted) click is ignored", forged && !store.guest);
  if (rect) await click(landing, Math.round(rect.x + rect.width / 2), Math.round(rect.y + rect.height / 2));
  await wait(500);
  check("a real click accepts the guest", !!store.guest && store.guest.visit.name === "Kiki");
  await wait(4500);
  let s = await state(landing);
  check("guest walks in and says hello", !!s.guest && s.bubble.includes("Kiki is visiting you"), JSON.stringify(s));
  await wait(4000);
  s = await state(landing);
  const gap = s.own && s.guest ? Math.abs(s.own.x - s.guest.x) : Infinity;
  check("guest walks over to your cat", gap < 200, `gap ${gap}px`);
  await snap(landing, "3-guest-arrived");
  landing.destroy();

  // 3. The guest follows to ordinary pages, which stay clickable.
  const page = await open(article, "", true, contentJs);
  await wait(3000);
  s = await state(page);
  check("own cat and guest both appear on a normal page", !!s.own && !!s.guest, JSON.stringify(s));
  const through = await js(page, "(() => { const el = document.elementFromPoint(640, 200); return el && el.id; })()");
  check("clicks away from the cats reach the page", through === "content", `elementFromPoint -> ${through}`);
  await snap(page, "4-normal-page");

  // 4. Visit ends: the guest walks home and storage is cleaned up.
  store.guest.expiresAt = Date.now();
  broadcast({ guest: { newValue: store.guest } });
  await wait(1200);
  s = await state(page);
  check("guest says goodbye", s.bubble.includes("heading home"), s.bubble);
  await snap(page, "5-heading-home");
  for (let i = 0; i < 30 && store.guest; i++) await wait(500);
  s = await state(page);
  check("guest leaves and the visit is cleared", !store.guest && !s.guest, JSON.stringify(s));
  page.destroy();

  console.log(report.join("\n"));
  const failed = report.filter((l) => l.startsWith("FAIL")).length;
  app.exit(failed ? 1 : 0);
}

// Each step closes its window before opening the next; don't let that quit the app.
app.on("window-all-closed", () => {});
app.whenReady().then(() => run().catch((e) => { console.error(e); app.exit(2); }));
