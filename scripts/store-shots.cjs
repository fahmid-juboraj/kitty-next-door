// Renders store screenshots (1280x800) from the real built extension and site:
//   store/screenshot-1-visit.png   your cat + a visiting cat on an ordinary page
//   store/popup.png                the popup (composited into screenshot 2 afterwards)
//   store/screenshot-3-landing.png the page a friend sees when opening a visit link
//   node scripts/run.mjs scripts/store-shots.cjs   (after `npm run build:ext` and `npm --prefix realtime run build:prod`)
const { app, BrowserWindow, ipcMain, nativeTheme } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const repo = path.join(__dirname, "..");
const out = path.join(repo, "store");
const content = fs.readFileSync(path.join(repo, "realtime/extension/dist/chrome/content.js"), "utf8");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let store = {};
ipcMain.on("storage-get", (e, keys) => {
  const list = keys == null ? Object.keys(store) : [].concat(keys);
  e.returnValue = JSON.parse(JSON.stringify(Object.fromEntries(list.filter((k) => k in store).map((k) => [k, store[k]]))));
});
ipcMain.on("storage-set", (e, items) => { Object.assign(store, JSON.parse(JSON.stringify(items))); e.returnValue = true; });
ipcMain.on("storage-remove", (e, keys) => { for (const k of [].concat(keys)) delete store[k]; e.returnValue = true; });
ipcMain.on("sent", () => {});

const me = { code: "7K2F9QXM", profile: { cat: "Mochi", coat: "ginger", owner: "Fahmid" } };
const sam = { code: "5AMK1K10", profile: { cat: "Kiki", coat: "black", owner: "Sam" } };
const ana = { code: "ANA42XYZ", profile: { cat: "Tofu", coat: "cream", owner: "Ana" } };

async function shoot(file, opts, prep, name, settle) {
  const win = new BrowserWindow({ width: 1280, height: 800, show: false, useContentSize: true,
    webPreferences: { offscreen: true, contextIsolation: false, ...opts } });
  await win.loadFile(file.path, file.hash ? { hash: file.hash } : undefined);
  if (prep) await prep(win);
  await wait(settle);
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(out, name), img.toPNG());
  win.destroy();
}

async function run() {
  nativeTheme.themeSource = "light";
  fs.mkdirSync(out, { recursive: true });

  // 1. A visit in progress on an ordinary page.
  store = {
    settings: { enabled: true, coat: "ginger", name: "Mochi", disabledSites: [] },
    rt_state: { me, friends: [sam, ana], incoming: [], outgoing: [], cat: { where: "home" },
      guests: [{ owner: sam.code, profile: sam.profile, msg: "Thinking of you!", gift: "yarn", since: 7 }] },
  };
  await shoot({ path: path.join(repo, "scripts/store-demo-page.html") },
    { preload: path.join(repo, "scripts/ext-harness-preload.cjs") },
    (w) => w.webContents.executeJavaScript(content), "screenshot-1-visit.png", 7000);

  // 2. The popup (composited later).
  store.rt_conn = "online";
  store.rt_state = { ...store.rt_state, guests: [], incoming: [{ code: "LUNA7QPD", profile: { cat: "Luna", coat: "grey", owner: "Lee" } }] };
  const popup = new BrowserWindow({ width: 340, height: 760, show: false, useContentSize: true,
    webPreferences: { offscreen: true, contextIsolation: false, preload: path.join(repo, "realtime/tests/popup-preload.cjs") } });
  await popup.loadFile(path.join(repo, "realtime/extension/dist/chrome/popup.html"));
  await wait(800);
  fs.writeFileSync(path.join(out, "popup.png"), (await popup.webContents.capturePage()).toPNG());
  popup.destroy();

  // 3. What a friend sees when they open a visit link.
  const visit = { v: 1, name: "Mochi", coat: "ginger", from: "Fahmid", msg: "Come say hi to Mochi!", gift: "flower" };
  await shoot({ path: path.join(repo, "dist-site/visit/index.html"), hash: "visit=" + Buffer.from(JSON.stringify(visit)).toString("base64url") },
    {}, null, "screenshot-3-landing.png", 7000);

  app.exit(0);
}

app.on("window-all-closed", () => {});
app.whenReady().then(() => run().catch((e) => { console.error(e); app.exit(2); }));
