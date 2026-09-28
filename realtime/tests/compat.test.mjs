// The server must keep working for people still on the 0.1.0 extension
// (published to stores before letters and the park existed). Runs the real
// 0.1.0 background (tests/fixtures) next to the current build, both against
// a local `wrangler dev`, and checks they can still be friends and visit.
//   npm run server:test   (in another terminal), then: node extension/build.mjs && node --test tests/compat.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { Browser } from "./browser-sim.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const local = "ws://127.0.0.1:8787";
const oldCode = readFileSync(path.join(here, "fixtures", "v0.1.0-background.js"), "utf8")
  .replaceAll("wss://kitty-next-door.kittynextdoor.workers.dev", local);
const newCode = readFileSync(path.join(here, "..", "extension", "dist", "chrome", "background.js"), "utf8");
const settings = (name, coat) => ({ enabled: true, coat, name, disabledSites: [] });

after(() => Browser.all.forEach((b) => b.stop()));

test("0.1.0 and 0.2.0 users: friends, visits both ways, letters degrade gracefully", async () => {
  const old = new Browser("old-0.1.0", settings("Oldie", "grey"), oldCode);
  const cur = new Browser("new-0.2.0", settings("Newbie", "ginger"), newCode);
  await old.until((s) => s.rt_conn === "online" && s.rt_state, "0.1.0 online");
  await cur.until((s) => s.rt_conn === "online" && s.rt_state, "0.2.0 online");

  old.act({ t: "friend_request", code: cur.state.me.code });
  await cur.until((s) => s.rt_state.incoming.length === 1, "request reaches 0.2.0");
  cur.act({ t: "friend_respond", code: old.state.me.code, accept: true });
  await old.until((s) => s.rt_state.friends.length === 1, "0.1.0 has a friend");

  // Old -> new: a normal visit.
  old.act({ t: "send_cat", to: cur.state.me.code, msg: "from the past", gift: "fish" });
  await cur.until((s) => s.rt_state.guests[0]?.msg === "from the past", "0.2.0 hosts the 0.1.0 cat");
  old.act({ t: "recall" });
  await cur.until((s) => s.rt_state.guests.length === 0, "0.1.0 cat went home");

  // New -> old, with a letter the old client can't show: visit works, letter is dropped, sender is told.
  cur.act({ t: "send_cat", to: old.state.me.code, msg: "hello", gift: "yarn", letter: "Dear Oldie,\nthis is a letter." });
  await old.until((s) => s.rt_state.guests[0]?.msg === "hello", "0.1.0 hosts the 0.2.0 cat");
  assert.equal(old.state.guests[0].letter, undefined);
  assert.ok(!JSON.stringify(old.store).includes("this is a letter"), "letter never reached the old client");
  await cur.until((s) => s.rt_notice?.notice.error === "letter_not_delivered", "sender told the letter didn't arrive");

  // The old client's view of the world stays valid when the new one uses the park.
  cur.act({ t: "recall" });
  await cur.until((s) => s.rt_state.cat.where === "home", "0.2.0 cat home");
  cur.act({ t: "to_park" });
  await cur.until((s) => s.rt_state.cat.where === "park", "0.2.0 cat in the park");
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(old.store.rt_conn, "online");
  assert.equal(old.state.friends.length, 1);
  cur.act({ t: "recall" });
  await cur.until((s) => s.rt_state.cat.where === "home", "back from the park");
});
