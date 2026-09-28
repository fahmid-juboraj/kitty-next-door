// The public park: one Durable Object. Spectators (the /park/ web page) hold
// read-only WebSockets and get live join/leave/crown updates. Cats arrive and
// leave through RPC from their owners' UserDOs.
import { DurableObject } from "cloudflare:workers";
import type { ParkMsg, Profile } from "../../shared/protocol";
import type { PeerApi } from "./core";
import { ParkCore, type ParkState } from "./parkcore";
import type { Env } from "./user";

const MAX_SPECTATORS = 2000;
const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export class ParkDO extends DurableObject<Env> {
  private readonly core: ParkCore;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    this.core = new ParkCore({
      load: () => ctx.storage.get<ParkState>("park"),
      save: (s) => ctx.storage.put("park", s),
      send: (msg: ParkMsg) => {
        const data = JSON.stringify(msg);
        for (const ws of ctx.getWebSockets()) {
          try { ws.send(data); } catch { /* closing */ }
        }
      },
      owner: (code) => env.USERS.get(env.USERS.idFromName(code)) as unknown as PeerApi,
      setAlarm: (at) => (at === null ? ctx.storage.deleteAlarm() : ctx.storage.setAlarm(at)),
      randomId: () => [...crypto.getRandomValues(new Uint8Array(12))].map((b) => ID_ALPHABET[b % 36]).join(""),
      now: () => Date.now(),
    });
  }

  /** A spectator connecting from the park page. */
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("expected a websocket", { status: 426 });
    }
    const open = this.ctx.getWebSockets();
    if (open.length >= MAX_SPECTATORS) open[0].close(4000, "park is crowded");
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.send(JSON.stringify(await this.core.snapshot()));
    return new Response(null, { status: 101, webSocket: client });
  }

  // Spectators are read-only; anything but the auto-answered "ping" is ignored.
  async webSocketMessage(): Promise<void> {}

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try { ws.close(code, reason); } catch { /* already closed */ }
  }

  async alarm(): Promise<void> {
    await this.core.alarm();
  }

  // ---- RPC from owners' UserDOs ----
  join(owner: string, profile: Profile) { return this.core.join(owner, profile); }
  leave(id: string) { return this.core.leave(id); }

  // ---- moderation, via /admin/park (needs STATS_KEY) ----
  adminList() { return this.core.adminList(); }
  kick(id: string, block: boolean) { return this.core.kick(id, block); }
}
