import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanText, encodeVisit, LIMITS, parseVisitFragment, visitUrl, type Visit } from "../src/core/visit";

const good: Visit = { v: 1, name: "Mochi", coat: "ginger", from: "Fahmid", msg: "miss you!", gift: "fish" };
const rawFragment = (obj: unknown) =>
  "#visit=" + Buffer.from(JSON.stringify(obj)).toString("base64url");

test("round-trips a normal visit, including emoji and non-Latin text", () => {
  const v: Visit = { ...good, name: "モチ 🐱", msg: "আমি তোমাকে মিস করি" };
  assert.deepEqual(parseVisitFragment("#visit=" + encodeVisit(v)), v);
  assert.deepEqual(parseVisitFragment(new URL(visitUrl("https://x.test/visit/", v)).hash), v);
});

test("rejects malformed fragments", () => {
  for (const bad of ["", "#", "#visit=", "#visit=***", "#other=abc", "#visit=abc#visit=def", "visit=%%%"]) {
    assert.equal(parseVisitFragment(bad), null, bad);
  }
  assert.equal(parseVisitFragment("#visit=" + Buffer.from("not json").toString("base64url")), null);
  assert.equal(parseVisitFragment("#visit=" + Buffer.from([0xff, 0xfe, 0x00]).toString("base64url")), null);
  assert.equal(parseVisitFragment(rawFragment([1, 2, 3])), null);
  assert.equal(parseVisitFragment(rawFragment(null)), null);
});

test("rejects wrong version, missing name, unknown coat", () => {
  assert.equal(parseVisitFragment(rawFragment({ ...good, v: 2 })), null);
  assert.equal(parseVisitFragment(rawFragment({ ...good, name: "   " })), null);
  assert.equal(parseVisitFragment(rawFragment({ ...good, coat: "rainbow" })), null);
  assert.equal(parseVisitFragment(rawFragment({ ...good, coat: "__proto__" })), null);
  assert.equal(parseVisitFragment(rawFragment({ ...good, coat: "toString" })), null);
});

test("unknown gift falls back to fish; unknown fields are dropped", () => {
  const v = parseVisitFragment(rawFragment({ ...good, gift: "bomb", evil: "<script>" }));
  assert.equal(v?.gift, "fish");
  assert.equal("evil" in (v as object), false);
});

test("caps field lengths and the whole fragment", () => {
  const v = parseVisitFragment(rawFragment({ ...good, name: "N".repeat(60), msg: "m".repeat(200), from: "f".repeat(60) }));
  assert.equal(v?.name.length, LIMITS.name);
  assert.equal(v?.msg.length, LIMITS.msg);
  assert.equal(v?.from.length, LIMITS.from);
  assert.equal(parseVisitFragment("#visit=" + "A".repeat(LIMITS.fragment)), null);
});

test("markup survives only as inert text (rendering uses textContent)", () => {
  const v = parseVisitFragment(rawFragment({ ...good, msg: '<img src=x onerror="alert(1)">' }));
  assert.equal(v?.msg, '<img src=x onerror="alert(1)">'.slice(0, LIMITS.msg));
});

test("strips control and bidi-override characters", () => {
  assert.equal(cleanText("pay‮gnp.exe", 40), "paygnp.exe");
  assert.equal(cleanText("a\u0000b​c\n\td", 40), "abc d");
  assert.equal(cleanText(42, 10), "");
});

test("non-string fields become empty or are rejected", () => {
  assert.equal(parseVisitFragment(rawFragment({ ...good, name: { toString: 1 } })), null);
  const v = parseVisitFragment(rawFragment({ ...good, msg: ["x"], from: 7 }));
  assert.equal(v?.msg, "");
  assert.equal(v?.from, "");
});
