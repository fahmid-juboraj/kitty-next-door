// Worker entry:
//   /v1/connect/<CODE>  live server (one Durable Object per user)
//   /go/<button>        counts a website button click, then redirects
//   /stats?key=...      click counts (needs the STATS_KEY secret)
//   /v1/park            live view of the public park (read-only WebSocket)
//   /admin/park?key=... list cats in the park; &kick=<id> (&block=1) removes one
//   /badge/<name>.json  live download/install numbers for README badges (shields.io endpoint format)
//   everything else     static site files from ../../dist-site
import { CODE_RE } from "../../shared/protocol";
import { badge, BADGES, type BadgeName } from "./badges";
import { isBot, StatsDO, TARGETS, type BadgeEnv } from "./stats";
import type { Env as UserEnv } from "./user";

export { UserDO } from "./user";
export { ParkDO } from "./park";
export { StatsDO };

interface Env extends UserEnv, BadgeEnv {
  STATS: DurableObjectNamespace<StatsDO>;
  /** Set with `npx wrangler secret put STATS_KEY`. Without it, /stats is off. */
  STATS_KEY?: string;
}

const stats = (env: Env) => env.STATS.get(env.STATS.idFromName("website"));
const park = (env: Env) => env.PARK.get(env.PARK.idFromName("main"));
const authorized = (env: Env, url: URL) => !!env.STATS_KEY && url.searchParams.get("key") === env.STATS_KEY;

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);

    const connect = /^\/v1\/connect\/([^/]+)$/.exec(url.pathname);
    if (connect) {
      const code = connect[1];
      if (!CODE_RE.test(code)) return new Response("bad code", { status: 400 });
      // Always set the code ourselves; never trust a client-sent header.
      const headers = new Headers(request.headers);
      headers.set("X-Kitty-Code", code);
      return env.USERS.get(env.USERS.idFromName(code)).fetch(new Request(request, { headers }));
    }

    const go = /^\/go\/([a-z]+)\/?$/.exec(url.pathname);
    if (go && Object.hasOwn(TARGETS, go[1])) {
      const target = go[1];
      if (!isBot(request.headers.get("user-agent"))) {
        console.log(JSON.stringify({ event: "click", target }));
        ctx.waitUntil(stats(env).hit(target));
      }
      return new Response(null, { status: 302, headers: { location: TARGETS[target], "cache-control": "no-store" } });
    }

    if (url.pathname === "/stats") {
      if (!authorized(env, url)) return new Response("not found", { status: 404 });
      return Response.json(await stats(env).report(), { headers: { "cache-control": "no-store" } });
    }

    if (url.pathname === "/v1/park") return park(env).fetch(request);

    const b = /^\/badge\/([a-z]+)\.json$/.exec(url.pathname);
    if (b && (BADGES as readonly string[]).includes(b[1])) {
      const counts = await stats(env).counts();
      return Response.json(badge(b[1] as BadgeName, counts), {
        headers: { "cache-control": "public, max-age=300", "access-control-allow-origin": "*" },
      });
    }
    if (url.pathname === "/badge/counts.json") {
      return Response.json(await stats(env).counts(), { headers: { "cache-control": "public, max-age=300", "access-control-allow-origin": "*" } });
    }

    if (url.pathname === "/admin/park") {
      if (!authorized(env, url)) return new Response("not found", { status: 404 });
      const kick = url.searchParams.get("kick");
      if (kick) return Response.json({ removed: await park(env).kick(kick, url.searchParams.get("block") === "1") });
      return Response.json(await park(env).adminList(), { headers: { "cache-control": "no-store" } });
    }

    return new Response("not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
