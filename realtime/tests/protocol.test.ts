import assert from "node:assert/strict";
import { test } from "node:test";
import { formatCode, normCode, parseClientMsg, parseServerMsg } from "../shared/protocol";

const TOKEN = "A".repeat(43);
const profile = { cat: "Mochi", coat: "ginger", owner: "Fahmid" };

test("friend codes: normalization and look-alike letters", () => {
  assert.equal(normCode("7k2f-9qxm"), "7K2F9QXM");
  assert.equal(normCode(" 7K2F 9QXM "), "7K2F9QXM");
  assert.equal(normCode("OOOO-IIII"), "00001111");
  assert.equal(normCode("7K2F9QX"), null);
  assert.equal(normCode("7K2F9QXU"), null); // U isn't in the alphabet
  assert.equal(normCode(12345678), null);
  assert.equal(formatCode("7K2F9QXM"), "7K2F-9QXM");
});

test("client messages are validated and cleaned", () => {
  assert.deepEqual(parseClientMsg(JSON.stringify({ t: "hello", token: TOKEN, profile })), { t: "hello", token: TOKEN, profile });
  assert.equal(parseClientMsg(JSON.stringify({ t: "hello", token: "short", profile })), null);
  assert.equal(parseClientMsg(JSON.stringify({ t: "hello", token: TOKEN, profile: { ...profile, coat: "rainbow" } })), null);
  assert.deepEqual(parseClientMsg(JSON.stringify({ t: "send_cat", to: "7k2f-9qxm", msg: "a‮b  c", gift: "bomb" })),
    { t: "send_cat", to: "7K2F9QXM", msg: "ab c", gift: "fish" });
  assert.deepEqual(parseClientMsg(JSON.stringify({ t: "friend_respond", code: "7K2F9QXM", accept: true })),
    { t: "friend_respond", code: "7K2F9QXM", accept: true });
  assert.equal(parseClientMsg(JSON.stringify({ t: "friend_respond", code: "7K2F9QXM", accept: "yes" })), null);
  assert.deepEqual(parseClientMsg('{"t":"recall","extra":1}'), { t: "recall" });
});

test("junk, oversized and unknown frames are dropped", () => {
  for (const bad of ["", "null", "[]", "42", "{", '{"t":"hack"}', '{"t":"__proto__"}', "x".repeat(3000)]) {
    assert.equal(parseClientMsg(bad), null, bad.slice(0, 20));
  }
  assert.equal(parseClientMsg(JSON.stringify({ t: "send_cat", to: "7K2F9QXM", msg: "x".repeat(2100) })), null);
  assert.equal(parseClientMsg({ t: "recall" }), null);
});

test("server snapshots are re-validated on the client", () => {
  const state = {
    me: { code: "7K2F9QXM", profile },
    friends: [{ code: "bad", profile }, { code: "AAAAAAAA", profile: { cat: "<b>K</b>", coat: "grey", owner: "" } }],
    incoming: [], outgoing: [],
    cat: { where: "away", at: "AAAAAAAA", since: 1, returnAt: "soon" },
    guests: [{ owner: "AAAAAAAA", profile, msg: "hi", gift: "yarn", since: 5 }, { owner: "x" }],
  };
  const m = parseServerMsg(JSON.stringify({ t: "state", state }));
  assert.ok(m && m.t === "state");
  assert.deepEqual(m.state.friends.map((f) => f.code), ["AAAAAAAA"]);
  assert.equal(m.state.friends[0].profile?.cat, "<b>K</b>"); // plain text; rendered with textContent
  assert.deepEqual(m.state.cat, { where: "away", at: "AAAAAAAA", since: 1, returnAt: 0 });
  assert.equal(m.state.guests.length, 1);
  assert.equal(parseServerMsg(JSON.stringify({ t: "state", state: { ...state, me: { code: "nope", profile } } })), null);
  assert.equal(parseServerMsg(JSON.stringify({ t: "notice", notice: { kind: "explode" } })), null);
});
