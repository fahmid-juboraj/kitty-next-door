"use strict";
(() => {
  // ../../src/core/coats.ts
  var warmOutline = "#3b2b27";
  var COATS = {
    ginger: {
      id: "ginger",
      name: "Ginger",
      fur: "#f7ad63",
      shade: "#e08c45",
      stripe: "#e3843c",
      outline: warmOutline,
      innerEar: "#f6b7a6",
      nose: "#e98a8f",
      eye: "#2e2422",
      pupil: null,
      blush: "#f59a8f"
    },
    grey: {
      id: "grey",
      name: "Grey Tabby",
      fur: "#b3b7c2",
      shade: "#949aa8",
      stripe: "#858b99",
      outline: "#34323a",
      innerEar: "#f0b6b8",
      nose: "#e3959c",
      eye: "#2b2a30",
      pupil: null,
      blush: "#f2a3a8"
    },
    cream: {
      id: "cream",
      name: "Cream",
      fur: "#f5e6cc",
      shade: "#dfcaa8",
      stripe: "#e6cfa9",
      outline: warmOutline,
      innerEar: "#f6b9ae",
      nose: "#e99a98",
      eye: "#2e2422",
      pupil: null,
      blush: "#f5a597"
    },
    black: {
      id: "black",
      name: "Midnight",
      fur: "#3d3a46",
      shade: "#2c2a34",
      stripe: null,
      outline: "#16141b",
      innerEar: "#b9868f",
      nose: "#9c6a74",
      eye: "#f2cf55",
      pupil: "#1b1920",
      blush: "#c9748a"
    }
  };
  var DEFAULT_COAT = COATS.ginger;

  // ../../src/core/visit.ts
  var GIFTS = {
    fish: "\u{1F41F}",
    yarn: "\u{1F9F6}",
    flower: "\u{1F338}",
    mouse: "\u{1F42D}"
  };
  var LIMITS = { name: 24, from: 24, msg: 80, fragment: 1024 };
  var UNSAFE_RANGES = [
    [0, 31],
    [127, 159],
    [8203, 8207],
    [8234, 8238],
    [8288, 8297],
    [65279, 65279]
  ];
  var isUnsafe = (ch) => {
    const cp = ch.codePointAt(0);
    return UNSAFE_RANGES.some(([a, b]) => cp >= a && cp <= b);
  };
  function cleanText(input, max) {
    if (typeof input !== "string") return "";
    const chars = Array.from(input.replace(/\s+/g, " ")).filter((c) => !isUnsafe(c));
    return Array.from(chars.join("").trim()).slice(0, max).join("");
  }

  // ../../src/ext/api.ts
  var g = globalThis;
  var ext = g.browser ?? g.chrome;

  // ../../src/ext/state.ts
  var DEFAULT_SETTINGS = { enabled: true, coat: "ginger", name: "Mochi", disabledSites: [] };
  function validSettings(raw) {
    const r = raw && typeof raw === "object" ? raw : {};
    return {
      enabled: typeof r.enabled === "boolean" ? r.enabled : DEFAULT_SETTINGS.enabled,
      coat: typeof r.coat === "string" && Object.hasOwn(COATS, r.coat) ? r.coat : DEFAULT_SETTINGS.coat,
      name: cleanText(r.name, LIMITS.name) || DEFAULT_SETTINGS.name,
      disabledSites: Array.isArray(r.disabledSites) ? r.disabledSites.filter((s) => typeof s === "string" && s.length < 256).slice(0, 500) : []
    };
  }

  // ../shared/protocol.ts
  var CODE_RE = /^[0-9A-HJKMNP-TV-Z]{8}$/;
  var TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
  var MAX_FRAME = 2048;
  var CAPS = {
    friends: 50,
    pending: 20,
    guests: 3,
    /** Per rolling hour. */
    friendRequestsPerHour: 10,
    sendsPerHour: 20
  };
  function normCode(input) {
    if (typeof input !== "string" || input.length > 32) return null;
    const s = input.toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
    return CODE_RE.test(s) ? s : null;
  }
  function sanitizeProfile(raw) {
    if (!raw || typeof raw !== "object") return null;
    const r = raw;
    const cat = cleanText(r.cat, LIMITS.name);
    const coat = typeof r.coat === "string" && Object.hasOwn(COATS, r.coat) ? r.coat : null;
    if (!cat || !coat) return null;
    return { cat, coat, owner: cleanText(r.owner, LIMITS.from) };
  }
  var giftOf = (g3) => typeof g3 === "string" && Object.hasOwn(GIFTS, g3) ? g3 : "fish";
  function parseClientMsg(raw) {
    if (typeof raw !== "string" || raw.length > MAX_FRAME) return null;
    let m;
    try {
      const v = JSON.parse(raw);
      if (!v || typeof v !== "object" || Array.isArray(v)) return null;
      m = v;
    } catch {
      return null;
    }
    switch (m.t) {
      case "hello": {
        const profile2 = sanitizeProfile(m.profile);
        return typeof m.token === "string" && TOKEN_RE.test(m.token) && profile2 ? { t: "hello", token: m.token, profile: profile2 } : null;
      }
      case "profile": {
        const profile2 = sanitizeProfile(m.profile);
        return profile2 ? { t: "profile", profile: profile2 } : null;
      }
      case "friend_request":
      case "unfriend": {
        const code = normCode(m.code);
        return code ? { t: m.t, code } : null;
      }
      case "friend_respond": {
        const code = normCode(m.code);
        return code && typeof m.accept === "boolean" ? { t: "friend_respond", code, accept: m.accept } : null;
      }
      case "send_cat": {
        const to = normCode(m.to);
        return to ? { t: "send_cat", to, msg: cleanText(m.msg, LIMITS.msg), gift: giftOf(m.gift) } : null;
      }
      case "send_home": {
        const owner = normCode(m.owner);
        return owner ? { t: "send_home", owner } : null;
      }
      case "recall":
      case "delete_me":
        return { t: m.t };
      default:
        return null;
    }
  }
  function sanitizePerson(raw) {
    if (!raw || typeof raw !== "object") return null;
    const r = raw;
    const code = normCode(r.code);
    return code ? { code, profile: sanitizeProfile(r.profile) } : null;
  }
  var people = (raw, max) => Array.isArray(raw) ? raw.slice(0, max).map(sanitizePerson).filter((p) => !!p) : [];
  var num = (v) => typeof v === "number" && Number.isFinite(v) ? v : 0;
  function sanitizeCat(raw) {
    const r = raw && typeof raw === "object" ? raw : {};
    if (r.where === "away") {
      const at = normCode(r.at);
      if (at) return { where: "away", at, since: num(r.since), returnAt: num(r.returnAt) };
    }
    if (r.where === "traveling") {
      const to = normCode(r.to);
      if (to) return { where: "traveling", to };
    }
    return { where: "home" };
  }
  function sanitizeGuest(raw) {
    if (!raw || typeof raw !== "object") return null;
    const r = raw;
    const owner = normCode(r.owner);
    const profile2 = sanitizeProfile(r.profile);
    if (!owner || !profile2) return null;
    return { owner, profile: profile2, msg: cleanText(r.msg, LIMITS.msg), gift: giftOf(r.gift), since: num(r.since) };
  }
  var ERRORS = [
    "bad_message",
    "not_authed",
    "bad_token",
    "no_such_cat",
    "self",
    "not_friends",
    "already_friends",
    "too_many_friends",
    "too_many_pending",
    "rate_limited",
    "cat_busy",
    "host_full",
    "unreachable"
  ];
  var KINDS = ["friend_request", "friend_added", "guest_arrived", "guest_left", "cat_home", "error"];
  var REASONS = ["recalled", "sent_home", "timeout", "unfriended", "host_left"];
  function parseServerMsg(raw) {
    if (typeof raw !== "string" || raw.length > 256 * 1024) return null;
    let m;
    try {
      m = JSON.parse(raw);
      if (!m || typeof m !== "object") return null;
    } catch {
      return null;
    }
    if (m.t === "state" && m.state && typeof m.state === "object") {
      const s = m.state;
      const me = s.me;
      const code = normCode(me?.code);
      const profile2 = sanitizeProfile(me?.profile);
      if (!code || !profile2) return null;
      return {
        t: "state",
        state: {
          me: { code, profile: profile2 },
          friends: people(s.friends, CAPS.friends),
          incoming: people(s.incoming, CAPS.pending),
          outgoing: people(s.outgoing, CAPS.pending),
          cat: sanitizeCat(s.cat),
          guests: Array.isArray(s.guests) ? s.guests.slice(0, CAPS.guests).map(sanitizeGuest).filter((g3) => !!g3) : []
        }
      };
    }
    if (m.t === "notice" && m.notice && typeof m.notice === "object") {
      const n = m.notice;
      if (!KINDS.includes(n.kind)) return null;
      const notice = { kind: n.kind };
      const who = sanitizePerson(n.who);
      if (who) notice.who = who;
      if (REASONS.includes(n.reason)) notice.reason = n.reason;
      if (ERRORS.includes(n.error)) notice.error = n.error;
      return { t: "notice", notice };
    }
    return null;
  }

  // src/api.ts
  var g2 = globalThis;
  var ext2 = g2.browser ?? g2.chrome;
  var SERVER = true ? "wss://kitty-next-door.kittynextdoor.workers.dev" : "ws://127.0.0.1:8787";
  var K = {
    identity: "rt_identity",
    state: "rt_state",
    conn: "rt_conn",
    notice: "rt_notice",
    owner: "rt_owner",
    seen: "rt_seen",
    guestPos: "rt_guest_pos",
    error: "rt_fatal",
    /** Set after "Delete my account"; the extension stays offline until you start fresh. */
    deleted: "rt_deleted"
  };

  // src/background.ts
  var IDLE_S = 60;
  var KEEPALIVE_MS = 2e4;
  var ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  var ws = null;
  var ready = false;
  var queue = [];
  var backoff = 1e3;
  var reconnectTimer = null;
  var wantOnline = true;
  var everConnected = false;
  function randomCode() {
    const b = crypto.getRandomValues(new Uint8Array(8));
    return [...b].map((x) => ALPHABET[x % 32]).join("");
  }
  function randomToken() {
    const b = crypto.getRandomValues(new Uint8Array(32));
    return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  async function identity(fresh = false) {
    const r = await ext2.storage.local.get(K.identity);
    const id = r[K.identity];
    if (!fresh && id && typeof id.code === "string" && CODE_RE.test(id.code) && typeof id.token === "string" && TOKEN_RE.test(id.token)) {
      return id;
    }
    const created = { code: randomCode(), token: randomToken() };
    await ext2.storage.local.set({ [K.identity]: created });
    return created;
  }
  async function profile() {
    const r = await ext2.storage.local.get(["settings", K.owner]);
    const s = validSettings(r.settings);
    return { cat: s.name, coat: s.coat, owner: cleanText(r[K.owner], LIMITS.from) };
  }
  var setConn = (c) => ext2.storage.local.set({ [K.conn]: c });
  async function connect() {
    if (!wantOnline || ws && ws.readyState <= WebSocket.OPEN) return;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if ((await ext2.storage.local.get(K.deleted))[K.deleted]) {
      wantOnline = false;
      await setConn("offline");
      return;
    }
    const id = await identity();
    ready = false;
    setConn("connecting");
    const sock = new WebSocket(`${SERVER}/v1/connect/${id.code}`);
    ws = sock;
    sock.onopen = async () => {
      sock.send(JSON.stringify({ t: "hello", token: id.token, profile: await profile() }));
    };
    sock.onmessage = async (e) => {
      if (e.data === "pong") return;
      const m = parseServerMsg(e.data);
      if (!m) return;
      if (m.t === "state") {
        await ext2.storage.local.set({ [K.state]: m.state, [K.conn]: "online", [K.error]: null });
        if (!ready) {
          ready = true;
          everConnected = true;
          backoff = 1e3;
          const pending = queue;
          queue = [];
          pending.forEach((f) => sock.send(f));
        }
        return;
      }
      if (m.notice.kind === "error" && m.notice.error === "bad_token") {
        if (!everConnected) {
          await identity(true);
        } else {
          await ext2.storage.local.set({ [K.error]: "bad_token" });
          wantOnline = false;
        }
        return;
      }
      await ext2.storage.local.set({ [K.notice]: { notice: m.notice, id: `${Date.now()}-${Math.random()}` } });
    };
    sock.onclose = async (e) => {
      if (ws === sock) ws = null;
      ready = false;
      if (e.code === 4002) {
        wantOnline = false;
        await ext2.storage.local.remove([K.identity, K.state, K.seen, K.guestPos]);
        await ext2.storage.local.set({ [K.deleted]: true });
      }
      await setConn("offline");
      if (wantOnline) {
        reconnectTimer = setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, 6e4);
      }
    };
    sock.onerror = () => {
    };
  }
  function sendAction(action) {
    const frame = JSON.stringify(action);
    const m = parseClientMsg(frame);
    if (!m || m.t === "hello") return;
    if (ws && ready && ws.readyState === WebSocket.OPEN) ws.send(frame);
    else {
      if (queue.length < 20) queue.push(frame);
      wantOnline = true;
      connect();
    }
  }
  ext2.runtime.onMessage.addListener(async (msg) => {
    const m = msg;
    if (m?.startFresh) await ext2.storage.local.remove(K.deleted);
    if (m?.rt) sendAction(m.rt);
    if (m?.reconnect || m?.startFresh) {
      wantOnline = true;
      backoff = 1e3;
      connect();
    }
  });
  ext2.storage.onChanged.addListener(async (changes, area) => {
    if (area !== "local" || !(changes.settings || changes[K.owner])) return;
    sendAction({ t: "profile", profile: await profile() });
  });
  ext2.idle?.setDetectionInterval(IDLE_S);
  ext2.idle?.onStateChanged.addListener((state) => {
    ext2.storage.local.set({ idle: { state, since: Date.now() } });
    wantOnline = state === "active";
    if (wantOnline) {
      backoff = 1e3;
      connect();
    } else ws?.close(1e3, "idle");
  });
  setInterval(() => {
    if (!wantOnline) return;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send("ping");
    ext2.runtime.getPlatformInfo?.().catch(() => {
    });
  }, KEEPALIVE_MS);
  ext2.alarms?.create("rt-wake", { periodInMinutes: 1 });
  ext2.alarms?.onAlarm.addListener(() => {
    if (wantOnline) connect();
  });
  connect();
})();
