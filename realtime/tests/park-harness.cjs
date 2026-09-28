// End-to-end check of the park page against a local `wrangler dev`:
// real cats sent from simulated users appear on the page, the crown shows,
// and cats leave again. Saves frames of the scene.
//   npm run server:test (another terminal), npm run build:ext, then from the repo root:
//   node scripts/run.mjs realtime/tests/park-harness.cjs
const { app, BrowserWindow, nativeTheme } = require("electron");
const { randomBytes } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const repo = path.join(__dirname, "..", "..");
const out = path.join(repo, "realtime", "dist-test", "frames");
const SERVER = "ws://127.0.0.1:8787";
const report = [];
const check = (name, ok, detail = "") => report.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** A throwaway user that signs in and can send its cat to the park. */
async function user(cat, coat) {
  const code = [...randomBytes(8)].map((b) => ALPHABET[b % 32]).join("");
  const ws = new WebSocket(`${SERVER}/v1/connect/${code}`);
  const frames = [];
  ws.onmessage = (e) => { if (e.data !== "pong") frames.push(JSON.parse(e.data)); };
  await new Promise((res) => { ws.onopen = res; });
  ws.send(JSON.stringify({ t: "hello", token: randomBytes(32).toString("base64url"), profile: { cat, coat, owner: "" }, caps: ["letters", "park"] }));
  const until = async (pred) => { for (let i = 0; i < 200 && !frames.some(pred); i++) await wait(25); };
  await until((f) => f.t === "state");
  return {
    toPark: async () => { ws.send(JSON.stringify({ t: "to_park" })); await until((f) => f.t === "state" && f.state.cat.where === "park"); },
    home: () => ws.send(JSON.stringify({ t: "recall" })),
    remove: () => ws.send(JSON.stringify({ t: "delete_me" })),
    crowned: () => frames.some((f) => f.t === "notice" && f.notice.kind === "crowned"),
  };
}

async function run() {
  nativeTheme.themeSource = "light";
  fs.mkdirSync(out, { recursive: true });
  const win = new BrowserWindow({ width: 1280, height: 800, show: false, useContentSize: true,
    webPreferences: { offscreen: true, contextIsolation: false, preload: path.join(repo, "scripts", "ext-harness-preload.cjs") } });
  await win.loadFile(path.join(repo, "dist-site", "park", "index.html"), { search: `server=${SERVER}&phase=day` });
  const js = (c) => win.webContents.executeJavaScript(c);
  await wait(1500);
  const residents = await js("window.__parkTest.cats().filter((c) => c.resident).length");
  check("the park is never empty: resident cats live there", residents === 3, `${residents} residents`);
  check("the live counter ignores residents", /No visiting cats yet/.test(await js("window.__parkTest.count()")));

  const guests = [await user("Mochi", "ginger"), await user("Kiki", "black"), await user("Tofu", "cream"), await user("Miso", "grey")];
  for (const g of guests) await g.toPark();
  await wait(1500);
  const names = await js("window.__parkTest.cats().filter((c) => !c.resident).map((c) => c.name).sort()");
  check("cats sent to the park appear for viewers", JSON.stringify(names) === JSON.stringify(["Kiki", "Miso", "Mochi", "Tofu"]), JSON.stringify(names));
  check("the counter counts them", /4 cats are visiting/.test(await js("window.__parkTest.count()")), await js("window.__parkTest.count()"));
  check("one of them is Cat of the Hour, and its owner was told", !!(await js("window.__parkTest.crown()")) && guests.some((g) => g.crowned()));
  check("the crown shows on the page", !(await js(`document.getElementById("crown").hidden`)));

  // Let them play for a while, then look.
  await wait(9000);
  const acts = await js("window.__parkTest.cats().map((c) => c.activity)");
  check("cats are moving about", acts.some((a) => a === "walk") || acts.some((a) => a === "sit"), acts.join(","));
  fs.writeFileSync(path.join(out, "park-live.png"), (await win.webContents.capturePage()).toPNG());

  guests[0].home();
  await wait(6000);
  const leaving = await js("window.__parkTest.cats().filter((c) => c.leaving).map((c) => c.name)");
  const after = await js("window.__parkTest.cats().filter((c) => !c.resident && !c.leaving).map((c) => c.name)");
  check("it's seen walking out", leaving.includes("Mochi") || !after.includes("Mochi"), JSON.stringify(leaving));
  check("a cat called home walks out; the others stay", !after.includes("Mochi") && after.length === 3, JSON.stringify(after));
  for (const g of guests) g.remove();
  await wait(500);
  win.destroy();
  console.log(report.join("\n"));
  app.exit(report.some((l) => l.startsWith("FAIL")) ? 1 : 0);
}

app.on("window-all-closed", () => {});
app.whenReady().then(() => run().catch((e) => { console.error(e); app.exit(2); }));
