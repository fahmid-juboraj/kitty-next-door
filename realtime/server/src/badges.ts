// Live download/install badges for the README (shields.io "endpoint" badges).
// Every number comes from a real source: GitHub release downloads, the public
// addons.mozilla.org API, and store numbers the owner copies from dashboards
// that have no public API (Edge, Chrome). Website button clicks are not
// installs and are never counted here.

export interface ReleaseAsset { name: string; download_count: number }
export interface Release { assets: ReleaseAsset[] }

export interface Counts {
  github: { chrome: number; edge: number; firefox: number; windows: number; total: number };
  /** Firefox add-on daily users from AMO (0 until the listing exists). */
  firefoxStoreUsers: number;
  /** Copied by hand from store dashboards. */
  edgeStoreUsers: number;
  chromeStoreUsers: number;
  fetchedAt: number;
}

export const BADGES = ["installs", "downloads", "chrome", "edge", "firefox", "windows"] as const;
export type BadgeName = (typeof BADGES)[number];

const PLATFORM: [keyof Omit<Counts["github"], "total">, RegExp][] = [
  ["chrome", /-chrome-[\d.]+\.zip$/i],
  ["edge", /-edge-[\d.]+\.zip$/i],
  ["firefox", /-firefox-[\d.]+\.zip$/i],
  ["windows", /\.exe$/i],
];

/** Sum GitHub downloads per platform across every release. Source zips and checksums don't count. */
export function sumGithub(releases: Release[]): Counts["github"] {
  const out = { chrome: 0, edge: 0, firefox: 0, windows: 0, total: 0 };
  for (const r of releases) {
    for (const a of r.assets ?? []) {
      const n = Number.isFinite(a.download_count) ? Math.max(0, a.download_count) : 0;
      const match = PLATFORM.find(([, re]) => re.test(a.name));
      if (!match) continue;
      out[match[0]] += n;
      out.total += n;
    }
  }
  return out;
}

export const installsTotal = (c: Counts) => c.github.total + c.firefoxStoreUsers + c.edgeStoreUsers + c.chromeStoreUsers;

const fmt = (n: number) => (n >= 10_000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : n.toLocaleString("en-US"));

/** The JSON shields.io reads for https://img.shields.io/endpoint?url=... */
export function badge(name: BadgeName, c: Counts) {
  const base = { schemaVersion: 1, cacheSeconds: 600, color: "f7ad63", labelColor: "3b2b27" };
  switch (name) {
    case "installs": return { ...base, label: "installs", message: fmt(installsTotal(c)) };
    case "downloads": return { ...base, label: "downloads", message: fmt(c.github.total) };
    case "chrome": return { ...base, label: "Chrome", message: fmt(c.github.chrome + c.chromeStoreUsers), namedLogo: "googlechrome", logoColor: "white" };
    case "edge": return { ...base, label: "Edge", message: fmt(c.github.edge + c.edgeStoreUsers), namedLogo: "microsoftedge", logoColor: "white" };
    case "firefox": return { ...base, label: "Firefox", message: fmt(c.github.firefox + c.firefoxStoreUsers), namedLogo: "firefoxbrowser", logoColor: "white" };
    case "windows": return { ...base, label: "Windows", message: fmt(c.github.windows), namedLogo: "windows", logoColor: "white" };
  }
}

export interface FetchEnv {
  fetch: typeof fetch;
  repo: string;
  amoSlug: string;
  edgeUsers: number;
  chromeUsers: number;
  githubToken?: string;
  now: number;
}

/** Fetch fresh numbers. Failures fall back to the previous numbers rather than showing zeros. */
export async function fetchCounts(env: FetchEnv, previous?: Counts): Promise<Counts> {
  const headers: Record<string, string> = { "User-Agent": "kitty-next-door-badges", Accept: "application/vnd.github+json" };
  if (env.githubToken) headers.Authorization = `Bearer ${env.githubToken}`;
  let github = previous?.github ?? { chrome: 0, edge: 0, firefox: 0, windows: 0, total: 0 };
  try {
    const all: Release[] = [];
    for (let page = 1; page <= 5; page++) {
      const r = await env.fetch(`https://api.github.com/repos/${env.repo}/releases?per_page=100&page=${page}`, { headers });
      if (!r.ok) throw new Error(`github ${r.status}`);
      const batch = (await r.json()) as Release[];
      all.push(...batch);
      if (batch.length < 100) break;
    }
    github = sumGithub(all);
  } catch { /* keep previous */ }

  let firefoxStoreUsers = previous?.firefoxStoreUsers ?? 0;
  try {
    const r = await env.fetch(`https://addons.mozilla.org/api/v5/addons/addon/${encodeURIComponent(env.amoSlug)}/`, { headers: { "User-Agent": "kitty-next-door-badges" } });
    if (r.status === 404) firefoxStoreUsers = 0; // not listed (yet)
    else if (r.ok) {
      const j = (await r.json()) as { average_daily_users?: number };
      firefoxStoreUsers = Number.isFinite(j.average_daily_users) ? Math.max(0, j.average_daily_users!) : firefoxStoreUsers;
    }
  } catch { /* keep previous */ }

  return { github, firefoxStoreUsers, edgeStoreUsers: env.edgeUsers, chromeStoreUsers: env.chromeUsers, fetchedAt: env.now };
}
