import { COATS } from "../../../src/core/coats";
import { cleanText, GIFTS, LIMITS, type GiftId } from "../../../src/core/visit";
import { validSettings, type Settings } from "../../../src/ext/state";
import { formatCode, normCode, parseServerMsg, type ClientMsg, type Person, type Snapshot } from "../../shared/protocol";
import { ext, K, type Conn } from "./api";
import { catOf, describeNotice, nameOf } from "./text";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const ORIGINS = ["http://*/*", "https://*/*"];
const act = (m: ClientMsg) => ext.runtime.sendMessage({ rt: m }).catch(() => {});

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
}

function personRow(p: Person, sub: string, ...buttons: HTMLButtonElement[]): HTMLElement {
  const info = el("div", { className: "grow" }, el("div", { className: "name", textContent: nameOf(p) }), el("div", { className: "sub", textContent: sub }));
  return el("div", { className: "row" }, info, ...buttons);
}

function button(label: string, onClick: () => void, primary = false): HTMLButtonElement {
  const b = el("button", { type: "button", textContent: label, className: primary ? "primary" : "" });
  b.addEventListener("click", onClick);
  return b;
}

function timeLeft(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60_000));
  return min >= 60 ? `about ${Math.round(min / 60)} h` : `${Math.max(1, min)} min`;
}

async function main(): Promise<void> {
  const r = await ext.storage.local.get(["settings", K.owner, K.state, K.conn]);
  let settings: Settings = validSettings(r.settings);
  const saveSettings = (patch: Partial<Settings>) => {
    settings = { ...settings, ...patch };
    return ext.storage.local.set({ settings });
  };
  const snapshot = (raw: unknown): Snapshot | null => {
    const m = raw ? parseServerMsg(JSON.stringify({ t: "state", state: raw })) : null;
    return m?.t === "state" ? m.state : null;
  };

  let state = snapshot(r[K.state]);
  ext.runtime.sendMessage({ reconnect: true }).catch(() => {});

  if (ext.permissions && !(await ext.permissions.contains({ origins: ORIGINS }))) {
    $("perm").hidden = false;
    $("grant").addEventListener("click", async () => {
      if (await ext.permissions!.request({ origins: ORIGINS })) $("perm").hidden = true;
    });
  }

  // ---- settings ----
  const enabled = $<HTMLInputElement>("enabled");
  enabled.checked = settings.enabled;
  enabled.addEventListener("change", () => saveSettings({ enabled: enabled.checked }));

  const [tab] = (await ext.tabs?.query({ active: true, currentWindow: true })) ?? [];
  let host = "";
  try {
    const u = new URL(tab?.url ?? "");
    if (u.protocol === "http:" || u.protocol === "https:") host = u.hostname;
  } catch { /* no page */ }
  if (host) {
    $("siteRow").hidden = false;
    $("siteLabel").textContent = `Hide on ${host}`;
    const siteOff = $<HTMLInputElement>("siteOff");
    siteOff.checked = settings.disabledSites.includes(host);
    siteOff.addEventListener("change", () => {
      const others = settings.disabledSites.filter((h) => h !== host);
      saveSettings({ disabledSites: siteOff.checked ? [...others, host] : others });
    });
  }

  const name = $<HTMLInputElement>("name");
  name.value = settings.name;
  name.addEventListener("change", () => {
    const clean = cleanText(name.value, LIMITS.name);
    if (clean) saveSettings({ name: clean });
    name.value = clean || settings.name;
  });
  const owner = $<HTMLInputElement>("owner");
  owner.value = cleanText(r[K.owner], LIMITS.from);
  owner.addEventListener("change", () => {
    owner.value = cleanText(owner.value, LIMITS.from);
    ext.storage.local.set({ [K.owner]: owner.value });
  });

  const coats = $("coats");
  for (const coat of Object.values(COATS)) {
    const b = el("button", { type: "button", className: "coat", title: coat.name });
    b.setAttribute("aria-label", coat.name);
    b.style.background = coat.fur;
    b.setAttribute("aria-pressed", String(coat.id === settings.coat));
    b.addEventListener("click", () => {
      saveSettings({ coat: coat.id });
      coats.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    });
    coats.appendChild(b);
  }

  const gift = $<HTMLSelectElement>("gift");
  const giftNames: Record<GiftId, string> = { fish: "Fish", yarn: "Ball of yarn", flower: "Flower", mouse: "Toy mouse" };
  for (const id of Object.keys(GIFTS) as GiftId[]) gift.add(new Option(`${GIFTS[id]} ${giftNames[id]}`, id));
  const msg = $<HTMLInputElement>("msg");

  // ---- friends ----
  const addCode = $<HTMLInputElement>("addCode");
  const add = () => {
    const code = normCode(addCode.value);
    if (!code) {
      addCode.setCustomValidity("Friend codes look like 7K2F-9QXM");
      addCode.reportValidity();
      return;
    }
    addCode.setCustomValidity("");
    addCode.value = "";
    act({ t: "friend_request", code });
  };
  $("add").addEventListener("click", add);
  addCode.addEventListener("keydown", (e) => { if (e.key === "Enter") add(); });
  addCode.addEventListener("input", () => addCode.setCustomValidity(""));

  $("copyCode").addEventListener("click", async () => {
    if (!state) return;
    await navigator.clipboard.writeText(formatCode(state.me.code)).catch(() => {});
    $("copyCode").textContent = "Copied!";
    setTimeout(() => { $("copyCode").textContent = "Copy"; }, 1500);
  });
  $("recall").addEventListener("click", () => act({ t: "recall" }));
  $("deleteMe").addEventListener("click", () => {
    if (confirm("Delete your Kitty Next Door account? Friends lose you, visiting cats go home, and your friend code is erased.")) {
      act({ t: "delete_me" });
    }
  });

  function renderConn(c: Conn): void {
    $("dot").className = `dot ${c}`;
    $("conn").textContent = c === "online" ? "Online" : c === "connecting" ? "Connecting…" : "Offline, reconnecting…";
  }

  function render(): void {
    const s = state;
    const myCat = s?.me.profile.cat ?? settings.name;
    $("myCode").textContent = s ? formatCode(s.me.code) : "…";

    // Where's my cat?
    const cat = s?.cat ?? { where: "home" as const };
    const friendByCode = new Map(s?.friends.map((f) => [f.code, f]) ?? []);
    $("recall").hidden = cat.where !== "away";
    if (cat.where === "home") {
      $("catStatus").textContent = `${myCat} is home`;
      $("catSub").textContent = "Send them to visit a friend below.";
    } else if (cat.where === "traveling") {
      $("catStatus").textContent = `${myCat} is on the way…`;
      $("catSub").textContent = `Heading to ${nameOf(friendByCode.get(cat.to) ?? { code: cat.to, profile: null })}`;
    } else {
      $("catStatus").textContent = `${myCat} is visiting ${nameOf(friendByCode.get(cat.at) ?? { code: cat.at, profile: null })}`;
      $("catSub").textContent = `Back in ${timeLeft(cat.returnAt - Date.now())}`;
    }

    // Requests.
    $("requestsBox").hidden = !s?.incoming.length;
    $("requests").replaceChildren(...(s?.incoming ?? []).map((p) => personRow(p, `${catOf(p)} · ${formatCode(p.code)}`,
      button("Accept", () => act({ t: "friend_respond", code: p.code, accept: true }), true),
      button("Decline", () => act({ t: "friend_respond", code: p.code, accept: false })))));

    // Friends.
    const friends = s?.friends ?? [];
    $("sendOpts").hidden = friends.length === 0;
    $("friends").replaceChildren(...(friends.length ? friends.map((p) => {
      const send = button(`Send ${myCat}`, () => act({ t: "send_cat", to: p.code, msg: cleanText(msg.value, LIMITS.msg), gift: gift.value as GiftId }), true);
      send.disabled = cat.where !== "home";
      const remove = button("✕", () => {
        if (confirm(`Remove ${nameOf(p)} from your friends?`)) act({ t: "unfriend", code: p.code });
      });
      remove.title = "Remove friend";
      return personRow(p, `${catOf(p)} · ${formatCode(p.code)}`, send, remove);
    }) : [el("div", { className: "empty", textContent: "No friends yet. Add one with their code above." })]));
    $("outgoing").textContent = s?.outgoing.length
      ? `Waiting for ${s.outgoing.map((p) => formatCode(p.code)).join(", ")} to accept.` : "";

    // Guests.
    $("guestsBox").hidden = !s?.guests.length;
    $("guests").replaceChildren(...(s?.guests ?? []).map((g) => {
      const p = { code: g.owner, profile: g.profile };
      return personRow(p, `${GIFTS[g.gift]} ${g.profile.cat}${g.msg ? ` · “${g.msg}”` : ""}`,
        button("Send home", () => act({ t: "send_home", owner: g.owner })));
    }));
  }

  renderConn((r[K.conn] as Conn) ?? "connecting");
  render();
  ext.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[K.state]) { state = snapshot(changes[K.state].newValue); render(); }
    if (changes[K.conn]) renderConn(changes[K.conn].newValue as Conn);
    const n = changes[K.notice]?.newValue as { notice?: Parameters<typeof describeNotice>[0] } | undefined;
    const text = n?.notice ? describeNotice(n.notice, state) : null;
    if (text) {
      $("flash").textContent = text;
      $("flash").hidden = false;
    }
  });
  setInterval(render, 30_000);
}

main();
