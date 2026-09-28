// Runs the *built* extension background script twice (two "browsers") in Node
// with a mock chrome.* API, against a local `wrangler dev` server, and checks
// what each one writes to storage, which is exactly what the pages and popup read.
//   node extension/build.mjs && node --test tests/background.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { Browser as SimBrowser } from "./browser-sim.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const code = readFileSync(path.join(here, "..", "extension", "dist", "chrome", "background.js"), "utf8");
const browsers = SimBrowser.all;
class Browser extends SimBrowser {
  constructor(name, settings) { super(name, settings, code); }
}
after(() => browsers.forEach((b) => b.stop()));

test("two browsers: befriend, send the cat, it moves, profile syncs, idle disconnects, send-home", async () => {
  const a = new Browser("A", { enabled: true, coat: "ginger", name: "Mochi", disabledSites: [] });
  const b = new Browser("B", { enabled: true, coat: "black", name: "Kiki", disabledSites: [] });
  await a.until((s) => s.rt_conn === "online" && s.rt_state, "A online");
  await b.until((s) => s.rt_conn === "online" && s.rt_state, "B online");
  assert.match(a.state.me.code, /^[0-9A-HJKMNP-TV-Z]{8}$/);
  assert.equal(a.state.me.profile.cat, "Mochi");

  // Friend codes, typed the way people type them.
  const bCode = b.state.me.code;
  a.act({ t: "friend_request", code: `${bCode.slice(0, 4).toLowerCase()}-${bCode.slice(4)}` });
  await b.until((s) => s.rt_state.incoming.some((p) => p.code === a.state.me.code), "B sees request");
  b.act({ t: "friend_respond", code: a.state.me.code, accept: true });
  await a.until((s) => s.rt_state.friends.some((p) => p.code === bCode), "A has friend");

  a.act({ t: "send_cat", to: bCode, msg: "hi from A", gift: "flower" });
  await a.until((s) => s.rt_state.cat.where === "away", "A's cat away");
  await b.until((s) => s.rt_state.guests[0]?.msg === "hi from A", "B hosts guest");
  await b.until((s) => s.rt_notice?.notice.kind === "guest_arrived", "B arrival notice");

  // Renaming your cat reaches the friend who's hosting it.
  await a.ctx.chrome.storage.local.set({ settings: { ...a.store.settings, name: "Mochi II" } });
  await b.until((s) => s.rt_state.guests[0]?.profile.cat === "Mochi II", "B sees rename");

  // Idle drops the connection; activity brings it back.
  b.setIdle("locked");
  await b.until((s) => s.rt_conn === "offline", "B offline when locked");
  b.setIdle("active");
  await b.until((s) => s.rt_conn === "online", "B back online");

  b.act({ t: "send_home", owner: a.state.me.code });
  await a.until((s) => s.rt_state.cat.where === "home", "A's cat home");
  await a.until((s) => s.rt_notice?.notice.kind === "cat_home" && s.rt_notice.notice.reason === "sent_home", "A home notice");
  await b.until((s) => s.rt_state.guests.length === 0, "B guest gone");
});

test("an action while offline is queued and delivered after reconnecting", async () => {
  const a = new Browser("A2", { enabled: true, coat: "ginger", name: "Tofu", disabledSites: [] });
  const b = new Browser("B2", { enabled: true, coat: "grey", name: "Miso", disabledSites: [] });
  await a.until((s) => s.rt_conn === "online" && s.rt_state, "A online");
  await b.until((s) => s.rt_conn === "online" && s.rt_state, "B online");
  a.act({ t: "friend_request", code: b.state.me.code });
  await b.until((s) => s.rt_state.incoming.length === 1, "request");
  b.act({ t: "friend_respond", code: a.state.me.code, accept: true });
  await a.until((s) => s.rt_state.friends.length === 1, "friends");

  a.setIdle("locked");
  await a.until((s) => s.rt_conn === "offline", "A offline");
  a.act({ t: "send_cat", to: b.state.me.code, msg: "queued", gift: "fish" });
  await b.until((s) => s.rt_state.guests[0]?.msg === "queued", "queued send delivered");
});

test("a malformed action from a page never reaches the server", async () => {
  const a = new Browser("A3", { enabled: true, coat: "cream", name: "Bean", disabledSites: [] });
  await a.until((s) => s.rt_conn === "online" && s.rt_state, "online");
  a.act({ t: "hello", token: "x", profile: {} });
  a.act({ t: "send_cat", to: "<script>" });
  a.act("not an object");
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(a.store.rt_notice, undefined); // the server never saw anything to complain about
  assert.equal(a.store.rt_conn, "online");
});

test("deleting the account stays deleted: no silent re-registration until you start fresh", async () => {
  const a = new Browser("A4", { enabled: true, coat: "ginger", name: "Pip", disabledSites: [] });
  await a.until((s) => s.rt_conn === "online" && s.rt_state, "online");
  const oldCode = a.state.me.code;
  a.act({ t: "delete_me" });
  await a.until((s) => s.rt_deleted === true && !s.rt_identity && !s.rt_state, "deleted locally");
  // Everything that normally reconnects: backoff timer, alarm wake-up, coming back from idle, popup opening.
  a.wake();
  a.setIdle("active");
  a.message({ reconnect: true });
  await new Promise((r) => setTimeout(r, 3000));
  assert.equal(a.store.rt_identity, undefined, "no new identity was created");
  assert.equal(a.store.rt_conn, "offline");

  a.message({ startFresh: true });
  await a.until((s) => s.rt_conn === "online" && s.rt_state && !s.rt_deleted, "fresh account online");
  assert.notEqual(a.state.me.code, oldCode);
});
