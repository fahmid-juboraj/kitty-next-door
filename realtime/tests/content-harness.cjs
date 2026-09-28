// Off-screen check of the live content script: drives the storage snapshot
// directly (no server needed) and verifies what happens on the page.
//   node scripts/run.mjs realtime/tests/content-harness.cjs     (from the repo root)
const { app, BrowserWindow, ipcMain } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const repo = path.join(__dirname, "..", "..");
const out = path.join(repo, "realtime", "dist-test", "frames");
const contentJs = fs.readFileSync(path.join(repo, "realtime", "extension", "dist", "chrome", "content.js"), "utf8");
const page = path.join(repo, "scripts", "harness-article.html");

const store = {};
const wins = new Set();
const report = [];
const check = (name, ok, detail = "") => report.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const broadcast = (changes) => { for (const w of wins) if (!w.isDestroyed()) w.webContents.send("storage-changed", changes); };
ipcMain.on("storage-get", (e, keys) => {
  const list = keys == null ? Object.keys(store) : [].concat(keys);
  e.returnValue = JSON.parse(JSON.stringify(Object.fromEntries(list.filter((k) => k in store).map((k) => [k, store[k]]))));
});
ipcMain.on("storage-set", (e, items) => {
  const changes = {};
  for (const [k, v] of Object.entries(items)) { changes[k] = { oldValue: store[k], newValue: v }; store[k] = v; }
  broadcast(changes);
  e.returnValue = true;
});
ipcMain.on("storage-remove", (e, keys) => {
  for (const k of [].concat(keys)) delete store[k];
  e.returnValue = true;
});
/** Simulate the background writing new data. */
function put(items) {
  const changes = {};
  for (const [k, v] of Object.entries(items)) { changes[k] = { oldValue: store[k], newValue: v }; store[k] = v; }
  broadcast(changes);
}

const me = { code: "7K2F9QXM", profile: { cat: "Mochi", coat: "ginger", owner: "Fahmid" } };
const kiki = { code: "AAAABBBB", profile: { cat: "Kiki", coat: "black", owner: "Sam" } };
const snapshot = (over = {}) => ({ me, friends: [kiki], incoming: [], outgoing: [], cat: { where: "home" }, guests: [], ...over });

async function open(extraHtml) {
  const win = new BrowserWindow({
    width: 1280, height: 800, show: false,
    webPreferences: { offscreen: true, contextIsolation: false, preload: path.join(repo, "scripts", "ext-harness-preload.cjs") },
  });
  wins.add(win);
  await win.loadFile(page);
  if (extraHtml) await win.webContents.executeJavaScript(`document.body.insertAdjacentHTML("beforeend", ${JSON.stringify(extraHtml)})`);
  await win.webContents.executeJavaScript(contentJs);
  return win;
}
const state = (w) => w.webContents.executeJavaScript("window.__kittyLiveTest && window.__kittyLiveTest.state()");
async function snap(w, name) {
  const img = await w.webContents.capturePage();
  fs.writeFileSync(path.join(out, `${name}.png`), img.resize({ width: 960 }).toPNG());
}
async function until(w, pred, ms = 12000) {
  const end = Date.now() + ms;
  let s;
  while (Date.now() < end) {
    s = await state(w);
    if (s && pred(s)) return s;
    await wait(150);
  }
  return s;
}

async function run() {
  fs.mkdirSync(out, { recursive: true });
  Object.assign(store, { settings: { enabled: true, coat: "ginger", name: "Mochi", disabledSites: [] }, rt_state: snapshot() });

  const w = await open();
  let s = await until(w, (x) => !!x.own);
  check("your cat is on the page while home", !!s?.own, JSON.stringify(s?.own));
  await snap(w, "1-home");

  put({ rt_state: snapshot({ cat: { where: "traveling", to: kiki.code } }) });
  s = await until(w, (x) => x.own?.leaving);
  check("sending: your cat starts walking off", !!s?.own?.leaving);
  await wait(800);
  await snap(w, "2-leaving");
  put({ rt_state: snapshot({ cat: { where: "away", at: kiki.code, since: 1, returnAt: Date.now() + 3_600_000 } }) });
  s = await until(w, (x) => !x.own, 30000);
  check("...and is gone once off-screen", !s?.own, JSON.stringify(s?.own));

  const guest = { owner: kiki.code, profile: kiki.profile, msg: "hello <b>you</b>", gift: "yarn", since: 42 };
  put({ rt_state: snapshot({ cat: { where: "away", at: kiki.code, since: 1, returnAt: 0 }, guests: [guest] }) });
  s = await until(w, (x) => x.guests.length === 1 && x.bubble);
  check("a visitor walks in and says hello", s?.guests.length === 1 && s.bubble.includes("Kiki is visiting you"), s?.bubble);
  check("the note is plain text", !!s?.bubble.includes("<b>you</b>"));
  await wait(1500);
  await snap(w, "3-visitor");

  put({ rt_state: snapshot({ guests: [guest] }), rt_notice: { notice: { kind: "cat_home", who: kiki, reason: "sent_home" }, id: "1" } });
  s = await until(w, (x) => !!x.own && !!x.toast);
  check("your cat walks back in when it's home again", !!s?.own && !s.own.leaving && s.own.activity === "walk", JSON.stringify(s?.own));
  check("a toast explains what happened", !!s?.toast.includes("Sam sent Mochi home"), s?.toast);
  await wait(4000);
  await snap(w, "4-back-with-visitor");

  // A visitor carrying a letter: envelope over its head, click opens the letter.
  const letterText = ["Dear Mochi,", "", "Line two <b>not bold</b>", "Line three"].join("\n");
  put({ rt_state: snapshot({ guests: [{ ...guest, letter: letterText }] }) });
  s = await until(w, (x) => x.guests[0]?.envelope === true);
  check("a visitor with a letter shows an envelope", !!s?.guests[0]?.envelope);
  await w.webContents.executeJavaScript(`window.__kittyLiveTest.openLetterOf(${JSON.stringify(kiki.code)})`);
  s = await until(w, (x) => !!x.letter);
  check("clicking the visitor opens the letter, as plain text", !!s?.letter?.includes("Line two <b>not bold</b>") && !!s.letter.includes("A letter from Sam"), s?.letter?.slice(0, 80));
  await snap(w, "5-letter");

  put({ rt_state: snapshot() });
  s = await until(w, (x) => x.guests.every((g) => g.leaving));
  check("a visitor who leaves walks off", s?.guests.length === 1 && s.guests[0].leaving, JSON.stringify(s?.guests));
  s = await until(w, (x) => x.guests.length === 0, 30000);
  check("...and disappears", s?.guests.length === 0);
  w.destroy();

  // With the link-visit extension also installed, the live one steps aside.
  const both = await open("<kitty-next-door></kitty-next-door>");
  await wait(1500);
  const hosts = await both.webContents.executeJavaScript("document.querySelectorAll('kitty-next-door-live').length");
  s = await state(both);
  check("with the other cat extension present, no second cat", hosts === 0 && !s, `live hosts: ${hosts}`);
  both.destroy();

  console.log(report.join("\n"));
  app.exit(report.some((l) => l.startsWith("FAIL")) ? 1 : 0);
}

app.on("window-all-closed", () => {});
app.whenReady().then(() => run().catch((e) => { console.error(e); app.exit(2); }));
