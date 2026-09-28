// Counts clicks on the website's download buttons. One Durable Object holds a
// tiny SQLite table of (day, target) -> count. No IPs, cookies or user agents
// are stored; only the number of clicks per button per day.
import { DurableObject } from "cloudflare:workers";

/** Where each button goes. Change a target here when a store listing goes live. */
export const TARGETS: Record<string, string> = {
  chrome: "https://github.com/fahmid-juboraj/kitty-next-door#install-on-chrome",
  edge: "https://github.com/fahmid-juboraj/kitty-next-door#install-on-microsoft-edge",
  firefox: "https://github.com/fahmid-juboraj/kitty-next-door#install-on-firefox",
  windows: "https://github.com/fahmid-juboraj/kitty-next-door#install-the-windows-app",
  github: "https://github.com/fahmid-juboraj/kitty-next-door",
  privacy: "https://github.com/fahmid-juboraj/kitty-next-door/blob/main/realtime/PRIVACY.md",
  license: "https://github.com/fahmid-juboraj/kitty-next-door/blob/main/LICENSE",
};

/** Link-preview fetchers and crawlers shouldn't count as people clicking. */
export const isBot = (ua: string | null) =>
  !ua || /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|discord|embedly|curl|wget|python|headless/i.test(ua);

export class StatsDO extends DurableObject {
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env as never);
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS clicks (day TEXT NOT NULL, target TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, target))",
    );
  }

  hit(target: string): void {
    if (!Object.hasOwn(TARGETS, target)) return;
    const day = new Date().toISOString().slice(0, 10);
    this.ctx.storage.sql.exec(
      "INSERT INTO clicks (day, target, n) VALUES (?, ?, 1) ON CONFLICT (day, target) DO UPDATE SET n = n + 1",
      day, target,
    );
  }

  report(): { totals: Record<string, number>; last30Days: { day: string; target: string; n: number }[] } {
    const totals: Record<string, number> = {};
    for (const row of this.ctx.storage.sql.exec<{ target: string; n: number }>(
      "SELECT target, SUM(n) AS n FROM clicks GROUP BY target ORDER BY n DESC",
    )) totals[row.target] = row.n;
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const last30Days = [...this.ctx.storage.sql.exec<{ day: string; target: string; n: number }>(
      "SELECT day, target, n FROM clicks WHERE day >= ? ORDER BY day DESC, target", since,
    )];
    return { totals, last30Days };
  }
}
