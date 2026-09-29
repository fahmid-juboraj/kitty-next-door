import assert from "node:assert/strict";
import { test } from "node:test";
import { badge, fetchCounts, installsTotal, sumGithub, type Counts } from "../server/src/badges";

const releases = [
  { assets: [
    { name: "kitty-next-door-live-chrome-0.2.0.zip", download_count: 5 },
    { name: "kitty-next-door-live-edge-0.2.0.zip", download_count: 2 },
    { name: "kitty-next-door-live-firefox-0.2.0.zip", download_count: 3 },
    { name: "kitty-next-door-live-source-0.2.0.zip", download_count: 40 },
    { name: "Kitty-Next-Door-Setup-0.2.0.exe", download_count: 7 },
    { name: "Kitty-Next-Door-Portable-0.2.0.exe", download_count: 1 },
    { name: "SHA256SUMS.txt", download_count: 99 },
  ] },
  { assets: [{ name: "kitty-next-door-live-chrome-0.1.0.zip", download_count: 4 }] },
];

test("GitHub downloads are summed per platform across releases; source and checksums don't count", () => {
  assert.deepEqual(sumGithub(releases), { chrome: 9, edge: 2, firefox: 3, windows: 8, total: 22 });
  assert.deepEqual(sumGithub([{ assets: [{ name: "x.zip", download_count: -5 }] }]), { chrome: 0, edge: 0, firefox: 0, windows: 0, total: 0 });
});

const counts = (over: Partial<Counts> = {}): Counts => ({
  github: sumGithub(releases), firefoxStoreUsers: 10, edgeStoreUsers: 4, chromeStoreUsers: 0, fetchedAt: 1, ...over,
});

test("installs = GitHub downloads + store users, nothing else", () => {
  assert.equal(installsTotal(counts()), 22 + 10 + 4);
  assert.equal(badge("installs", counts()).message, "36");
  assert.equal(badge("firefox", counts()).message, "13");
  assert.equal(badge("edge", counts()).message, "6");
  assert.equal(badge("windows", counts()).message, "8");
  assert.equal(badge("downloads", counts()).message, "22");
  assert.equal(badge("chrome", counts()).schemaVersion, 1);
});

test("big numbers are shortened", () => {
  const big = counts({ github: { chrome: 0, edge: 0, firefox: 0, windows: 0, total: 12_345 }, firefoxStoreUsers: 0, edgeStoreUsers: 0 });
  assert.equal(badge("installs", big).message, "12.3k");
  assert.equal(badge("installs", counts({ github: { ...big.github, total: 1234 }, firefoxStoreUsers: 0, edgeStoreUsers: 0 })).message, "1,234");
});

test("fetching: real numbers in, previous numbers kept when a source is down, unlisted add-on = 0", async () => {
  const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const fetchOk = (async (url: string) =>
    url.includes("api.github.com") ? ok(releases) : ok({ average_daily_users: 12 })) as unknown as typeof fetch;
  const env = { fetch: fetchOk, repo: "a/b", amoSlug: "x", edgeUsers: 3, chromeUsers: 0, now: 100 };
  const fresh = await fetchCounts(env);
  assert.equal(fresh.github.total, 22);
  assert.equal(fresh.firefoxStoreUsers, 12);
  assert.equal(fresh.edgeStoreUsers, 3);

  const down = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
  const kept = await fetchCounts({ ...env, fetch: down, now: 200 }, fresh);
  assert.equal(kept.github.total, 22);
  assert.equal(kept.firefoxStoreUsers, 12);

  const unlisted = (async (url: string) => (url.includes("api.github.com") ? ok(releases) : ok({}, 404))) as unknown as typeof fetch;
  assert.equal((await fetchCounts({ ...env, fetch: unlisted }, fresh)).firefoxStoreUsers, 0);
});
