import { COATS } from "../core/coats";
import { VISIT_BASE } from "../core/config";
import { cleanText, GIFTS, LIMITS, visitUrl, type GiftId } from "../core/visit";
import { ext } from "./api";
import { loadStored, type Settings } from "./state";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const ORIGINS = ["http://*/*", "https://*/*"];

async function main(): Promise<void> {
  const stored = await loadStored();
  let settings: Settings = stored.settings;
  const saveSettings = (patch: Partial<Settings>) => {
    settings = { ...settings, ...patch };
    return ext.storage.local.set({ settings });
  };

  // Firefox lets users withhold site access; offer to ask for it.
  if (ext.permissions && !(await ext.permissions.contains({ origins: ORIGINS }))) {
    $("perm").hidden = false;
    $("grant").addEventListener("click", async () => {
      if (await ext.permissions!.request({ origins: ORIGINS })) $("perm").hidden = true;
    });
  }

  const enabled = $<HTMLInputElement>("enabled");
  enabled.checked = settings.enabled;
  enabled.addEventListener("change", () => saveSettings({ enabled: enabled.checked }));

  const [tab] = (await ext.tabs?.query({ active: true, currentWindow: true })) ?? [];
  const host = (() => {
    try {
      const u = new URL(tab?.url ?? "");
      return u.protocol === "http:" || u.protocol === "https:" ? u.hostname : "";
    } catch { return ""; }
  })();
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

  const coats = $("coats");
  for (const coat of Object.values(COATS)) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "coat";
    b.title = coat.name;
    b.setAttribute("aria-label", coat.name);
    b.style.background = coat.fur;
    b.setAttribute("aria-pressed", String(coat.id === settings.coat));
    b.addEventListener("click", () => {
      saveSettings({ coat: coat.id });
      coats.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    });
    coats.appendChild(b);
  }

  const guest = stored.guest;
  if (guest) {
    $("guestBox").hidden = false;
    const v = guest.visit;
    $("guestText").textContent = `${GIFTS[v.gift]} ${v.name}${v.from ? ` from ${v.from}` : ""} is staying with you`;
    const hours = Math.max(0, Math.round((guest.expiresAt - Date.now()) / 3_600_000));
    $("guestLeft").textContent = hours > 0 ? `Heads home in about ${hours} h` : "Heading home soon";
    $("sendHome").addEventListener("click", async () => {
      await ext.storage.local.set({ guest: { ...guest, expiresAt: Date.now() } });
      $("guestLeft").textContent = "Heading home now";
    });
  }

  const gift = $<HTMLSelectElement>("gift");
  const giftNames: Record<GiftId, string> = { fish: "Fish", yarn: "Ball of yarn", flower: "Flower", mouse: "Toy mouse" };
  for (const id of Object.keys(GIFTS) as GiftId[]) gift.add(new Option(`${GIFTS[id]} ${giftNames[id]}`, id));

  const from = $<HTMLInputElement>("from");
  const msg = $<HTMLInputElement>("msg");
  const link = $<HTMLInputElement>("link");
  $("send").addEventListener("click", async () => {
    const url = visitUrl(VISIT_BASE, {
      v: 1, name: settings.name, coat: settings.coat,
      from: cleanText(from.value, LIMITS.from), msg: cleanText(msg.value, LIMITS.msg), gift: gift.value as GiftId,
    });
    link.value = url;
    link.hidden = false;
    link.select();
    try {
      await navigator.clipboard.writeText(url);
      $("sendNote").textContent = `Link copied! Send it to a friend and ${settings.name} will come to stay.`;
    } catch {
      $("sendNote").textContent = "Copy the link above and send it to a friend.";
    }
  });
}

main();
