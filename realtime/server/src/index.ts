// Worker entry:
//   /v1/connect/<CODE>  live server (one Durable Object per user)
//   /go/<button>        counts a website button click, then redirects
//   /stats?key=...      click counts (needs the STATS_KEY secret)
//   everything else     static site files from ../../dist-site
import { CODE_RE } from "../../shared/protocol";
import { isBot, StatsDO, TARGETS } from "./stats";
import type { Env as UserEnv } from "./user";

export { UserDO } from "./user";
export { StatsDO };

interface Env extends UserEnv {
  STATS: DurableObjectNamespace<StatsDO>;
  /** Set with `npx wrangler secret put STATS_KEY`. Without it, /stats is off. */
  STATS_KEY?: string;
}

const stats = (env: Env) => env.STATS.get(env.STATS.idFromName("website"));

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
      const key = url.searchParams.get("key");
      if (!env.STATS_KEY || !key || key !== env.STATS_KEY) return new Response("not found", { status: 404 });
      return Response.json(await stats(env).report(), { headers: { "cache-control": "no-store" } });
    }

    return new Response("not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
