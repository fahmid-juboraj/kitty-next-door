// Off-screen check of the live popup: renders a snapshot, clicks every
// control, and checks what each one asks the background to do.
//   node scripts/run.mjs realtime/tests/popup-harness.cjs     (from the repo root)
const { app, BrowserWindow, ipcMain } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const repo = path.join(__dirname, "..", "..");
const popup = path.join(repo, "realtime", "extension", "dist", "chrome", "popup.html");
const out = path.join(repo, "realtime", "dist-test", "frames");
const store = {};
const sent = [];
let win;
const report = [];
const check = (name, ok, detail = "") => report.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

ipcMain.on("storage-get", (e, keys) => {
  const list = keys == null ? Object.keys(store) : [].concat(keys);
  e.returnValue = JSON.parse(JSON.stringify(Object.fromEntries(list.filter((k) => k in store).map((k) => [k, store[k]]))));
});
function put(items) {
  const changes = {};
  for (const [k, v] of Object.entries(items)) { changes[k] = { oldValue: store[k], newValue: v }; store[k] = v; }
  if (win && !win.isDestroyed()) win.webContents.send("storage-changed", changes);
}
ipcMain.on("storage-set", (e, items) => { put(items); e.returnValue = true; });
ipcMain.on("storage-remove", (e, keys) => { for (const k of [].concat(keys)) delete store[k]; e.returnValue = true; });
ipcMain.on("sent", (_e, m) => sent.push(m));

const SAM = "SAM00000", LEE = "NEE00000", KIKI = "K1K10000", ME = "7K2F9QXM";
const person = (code, cat, owner) => ({ code, profile: { cat, coat: "grey", owner } });
const snapshot = (cat) => ({
  me: { code: ME, profile: { cat: "Mochi", coat: "ginger", owner: "Fahmid" } },
  friends: [person(SAM, "Biscuit", "Sam")],
  incoming: [person(LEE, "Noodle", "Lee")],
  outgoing: [],
  cat,
  guests: [{ owner: KIKI, profile: { cat: "Kiki", coat: "black", owner: "Ana" }, msg: "hi!", gift: "yarn", since: 1 }],
});

const js = (code) => win.webContents.executeJavaScript(code);
const text = (id) => js(`document.getElementById(${JSON.stringify(id)})?.textContent ?? null`);
const clickButton = (label) => js(`(() => {
  const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === ${JSON.stringify(label)});
  if (!b) return false; b.click(); return true; })()`);
const lastSent = () => sent[sent.length - 1];

async function run() {
  fs.mkdirSync(out, { recursive: true });
  Object.assign(store, {
    settings: { enabled: true, coat: "ginger", name: "Mochi", disabledSites: [] },
    rt_conn: "online",
    rt_state: snapshot({ where: "away", at: SAM, since: Date.now(), returnAt: Date.now() + 90 * 60_000 }),
  });
  win = new BrowserWindow({
    width: 360, height: 1100, show: false,
    webPreferences: { offscreen: true, contextIsolation: false, preload: path.join(__dirname, "popup-preload.cjs") },
  });
  await win.loadFile(popup);
  await wait(600);

  check("asks the background to connect when opened", sent.some((m) => m.reconnect === true));
  check("shows your friend code, formatted", (await text("myCode")) === "7K2F-9QXM", await text("myCode"));
  check("shows where your cat is", (await text("catStatus")) === "Mochi is visiting Sam", await text("catStatus"));
  check("shows when it's back", (await text("catSub")) === "Back in about 2 h", await text("catSub"));
  check("shows online", (await text("conn")) === "Online");
  const sendDisabled = await js(`[...document.querySelectorAll("button")].find((b) => b.textContent === "Send Mochi")?.disabled`);
  check("can't send the cat while it's away", sendDisabled === true);
  await win.webContents.capturePage().then((img) => fs.writeFileSync(path.join(out, "popup.png"), img.toPNG()));

  await clickButton("Accept");
  check("Accept sends friend_respond", JSON.stringify(lastSent()) === JSON.stringify({ rt: { t: "friend_respond", code: LEE, accept: true } }), JSON.stringify(lastSent()));
  await clickButton("Call home");
  check("Call home sends recall", lastSent()?.rt?.t === "recall");
  await clickButton("Send home");
  check("Send home sends the guest's owner", JSON.stringify(lastSent()) === JSON.stringify({ rt: { t: "send_home", owner: KIKI } }));

  put({ rt_state: snapshot({ where: "home" }) });
  await wait(200);
  check("status updates live", (await text("catStatus")) === "Mochi is home");
  await js(`document.getElementById("msg").value = "  see you <soon>  "; document.getElementById("gift").value = "mouse";`);
  await clickButton("Send Mochi");
  check("Send sends the cleaned note and gift", JSON.stringify(lastSent()) === JSON.stringify({ rt: { t: "send_cat", to: SAM, msg: "see you <soon>", gift: "mouse" } }), JSON.stringify(lastSent()));

  await js(`document.getElementById("addCode").value = "7k2f 9qxz"`);
  await clickButton("Add");
  check("Add normalizes a typed code", JSON.stringify(lastSent()) === JSON.stringify({ rt: { t: "friend_request", code: "7K2F9QXZ" } }), JSON.stringify(lastSent()));
  const before = sent.length;
  await js(`document.getElementById("addCode").value = "hello!"`);
  await clickButton("Add");
  check("an invalid code sends nothing", sent.length === before);

  await clickButton("Delete my account");
  check("delete needs a second click", sent.length === before && (await text("deleteMe")) === "Click again to delete everything");
  await clickButton("Click again to delete everything");
  check("...and then sends delete_me", lastSent()?.rt?.t === "delete_me");

  // Park and letters.
  await clickButton("🌳 Send to the Park");
  check("Send to the Park sends to_park", lastSent()?.rt?.t === "to_park", JSON.stringify(lastSent()));
  put({ rt_state: snapshot({ where: "park", since: Date.now(), returnAt: Date.now() + 50 * 60_000 }) });
  await wait(200);
  check("shows the cat is at the park", (await text("catStatus")) === "Mochi is at the Kitty Park 🌳", await text("catStatus"));
  check("can't send to the park twice", await js(`document.getElementById("toPark").disabled === true`));
  check("Watch the park links to the park page", /\/park\/$/.test(await js(`document.getElementById("watchPark").href`)));
  put({ rt_state: snapshot({ where: "home" }) });
  await wait(200);
  await js(`document.getElementById("letter").value = "Hi!\\r\\n\\r\\n\\r\\nSee you soon  "; document.getElementById("letter").dispatchEvent(new Event("input"))`);
  check("letter counter", (await text("letterCount")) === "20 / 1500", await text("letterCount"));
  await clickButton("Send Mochi");
  check("Send includes the cleaned letter", lastSent()?.rt?.letter === "Hi!\n\nSee you soon", JSON.stringify(lastSent()));
  check("letter box clears after sending", (await js(`document.getElementById("letter").value`)) === "");
  const withLetter = snapshot({ where: "home" });
  withLetter.guests[0].letter = "A secret recipe\nstep 1";
  put({ rt_state: withLetter });
  await wait(200);
  await clickButton("📩 Read");
  check("a visitor's letter can be read in the popup", (await js(`document.querySelector(".letter")?.textContent`)) === "A secret recipe\nstep 1");

  put({ rt_deleted: true, rt_state: null });
  await wait(200);
  check("after deletion, offers to start fresh", await js(`!document.getElementById("deletedBox").hidden`));
  await clickButton("Start fresh with a new friend code");
  check("Start fresh asks the background for a new account", lastSent()?.startFresh === true);

  console.log(report.join("\n"));
  app.exit(report.some((l) => l.startsWith("FAIL")) ? 1 : 0);
}

app.on("window-all-closed", () => {});
app.whenReady().then(() => run().catch((e) => { console.error(e); app.exit(2); }));
