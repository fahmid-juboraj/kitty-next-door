// Worker entry: routes /v1/connect/<CODE> to that user's Durable Object.
import { CODE_RE } from "../../shared/protocol";
import type { Env } from "./user";

export { UserDO } from "./user";

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const m = /^\/v1\/connect\/([^/]+)$/.exec(url.pathname);
    if (m) {
      const code = m[1];
      if (!CODE_RE.test(code)) return new Response("bad code", { status: 400 });
      // Always set the code ourselves; never trust a client-sent header.
      const headers = new Headers(request.headers);
      headers.set("X-Kitty-Code", code);
      return env.USERS.get(env.USERS.idFromName(code)).fetch(new Request(request, { headers }));
    }
    if (url.pathname === "/") {
      return new Response("Kitty Next Door Live server\n", { headers: { "content-type": "text/plain" } });
    }
    return new Response("not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
