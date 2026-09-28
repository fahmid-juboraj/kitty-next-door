// One Durable Object per user (named by friend code). It holds that user's
// WebSocket connections with the hibernation API, so an idle user costs
// nothing, and exposes the peer methods other users' objects call over RPC.
import { DurableObject } from "cloudflare:workers";
import { CODE_RE, parseClientMsg, type HomeReason, type Profile, type ServerMsg } from "../../shared/protocol";
import type { GiftId } from "../../../src/core/visit";
import { UserCore, type ParkApi, type PeerApi, type UserRecord } from "./core";
import type { ParkDO } from "./park";

export interface Env {
  USERS: DurableObjectNamespace<UserDO>;
  PARK: DurableObjectNamespace<ParkDO>;
  /** How long a trip to the park lasts (seconds). */
  PARK_STAY_SECONDS?: string;
  /** How long a visit lasts before the cat walks home (seconds). */
  STAY_SECONDS?: string;
}

interface Attachment {
  code: string;
  authed: boolean;
}

const MAX_CONNECTIONS = 4;
const frame = (msg: ServerMsg) => JSON.stringify(msg);
const errorFrame = (error: string) => JSON.stringify({ t: "notice", notice: { kind: "error", error } });

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export class UserDO extends DurableObject<Env> {
  private readonly core: UserCore;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Keepalive pings are answered without waking this object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    this.core = new UserCore({
      load: () => ctx.storage.get<UserRecord>("user"),
      save: (r) => ctx.storage.put("user", r),
      wipe: () => ctx.storage.deleteAll(),
      peer: (code) => env.USERS.get(env.USERS.idFromName(code)) as unknown as PeerApi,
      park: () => env.PARK.get(env.PARK.idFromName("main")) as unknown as ParkApi,
      send: (msg) => {
        const data = frame(msg);
        for (const ws of ctx.getWebSockets()) {
          if ((ws.deserializeAttachment() as Attachment | null)?.authed) {
            try { ws.send(data); } catch { /* closing */ }
          }
        }
      },
      setAlarm: (at) => (at === null ? ctx.storage.deleteAlarm() : ctx.storage.setAlarm(at)),
      hash: async (token) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))),
      now: () => Date.now(),
      stayMs: Math.max(1, Number(env.STAY_SECONDS ?? 7200)) * 1000,
      parkStayMs: Math.max(1, Number(env.PARK_STAY_SECONDS ?? 3600)) * 1000,
    });
  }

  async fetch(request: Request): Promise<Response> {
    const code = request.headers.get("X-Kitty-Code");
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket" || !code || !CODE_RE.test(code)) {
      return new Response("expected a websocket", { status: 426 });
    }
    const open = this.ctx.getWebSockets();
    if (open.length >= MAX_CONNECTIONS) open[0].close(4000, "too many connections");
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ code, authed: false } satisfies Attachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const att = ws.deserializeAttachment() as Attachment;
    const m = parseClientMsg(typeof message === "string" ? message : null);
    if (!m) return ws.send(errorFrame("bad_message"));

    if (!att.authed) {
      if (m.t !== "hello") return ws.send(errorFrame("not_authed"));
      if (!(await this.core.authenticate(att.code, m.token, m.profile))) {
        ws.send(errorFrame("bad_token"));
        ws.close(4001, "bad token");
        return;
      }
      ws.serializeAttachment({ ...att, authed: true } satisfies Attachment);
      await this.core.welcome(m.profile, m.caps);
      return;
    }

    await this.core.handle(m);
    if (m.t === "delete_me") for (const s of this.ctx.getWebSockets()) s.close(4002, "account deleted");
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try { ws.close(code, reason); } catch { /* already closed */ }
  }

  async alarm(): Promise<void> {
    await this.core.alarm();
  }

  // ---- RPC surface for other users' objects (never reachable from clients) ----

  friendRequest(from: string, profile: Profile) { return this.core.friendRequest(from, profile); }
  friendAccepted(from: string, profile: Profile) { return this.core.friendAccepted(from, profile); }
  friendDeclined(from: string) { return this.core.friendDeclined(from); }
  unfriended(from: string) { return this.core.unfriended(from); }
  hostGuest(g: { owner: string; profile: Profile; msg: string; gift: GiftId }) { return this.core.hostGuest(g); }
  removeGuest(owner: string) { return this.core.removeGuest(owner); }
  catReturned(host: string, reason: HomeReason) { return this.core.catReturned(host, reason); }
  profileChanged(from: string, profile: Profile) { return this.core.profileChanged(from, profile); }
  isCatWith(host: string) { return this.core.isCatWith(host); }
  isInPark(parkId: string) { return this.core.isInPark(parkId); }
  crowned() { return this.core.crowned(); }
}
