// Landing page for visit links. Works without the extension: the visiting
// cat walks onto this page and delivers its note. If the extension is
// installed it takes over (it marks <html data-kitty-next-door>).
import { COATS, DEFAULT_COAT } from "../core/coats";
import { REPO_URL } from "../core/config";
import { GIFTS, parseVisitFragment } from "../core/visit";
import { Bubble, CatActor, startLoop } from "../web/actor";

const $ = (id: string) => document.getElementById(id)!;

for (const id of ["getChrome", "getFirefox", "getEdge", "getWindows"]) {
  (document.getElementById(id) as HTMLAnchorElement).href = `${REPO_URL}#download-windows-1011`;
}

function render(): void {
  const visit = parseVisitFragment(location.hash);
  if (!visit) {
    $("title").textContent = location.hash ? "This visit link looks broken" : "A cat that keeps you company";
    $("note").hidden = true;
    return;
  }
  document.title = `${visit.name} came to visit you · Kitty Next Door`;
  $("title").textContent = `${visit.name} came to visit you`;
  $("gift").textContent = GIFTS[visit.gift];
  $("msg").textContent = visit.msg ? `“${visit.msg}”` : `${visit.name} wanted to keep you company.`;
  $("from").textContent = visit.from ? `from ${visit.from}` : "";
  $("note").hidden = false;
}

render();
window.addEventListener("hashchange", render);

// The demo cat on this page, only when the extension isn't there to show the real one.
const stage = $("stage");
const visit = parseVisitFragment(location.hash);
const cat = new CatActor(stage, visit ? COATS[visit.coat] ?? DEFAULT_COAT : DEFAULT_COAT, {
  x: innerWidth * 0.5, groundY: innerHeight, scale: innerWidth < 500 ? 1.2 : 1.6,
});
cat.brain.enterFrom(-1, innerWidth);
const bubble = new Bubble(stage);
let greeted = false;
let cursor: { x: number; y: number } | null = null;
window.addEventListener("pointermove", (e) => { cursor = { x: e.clientX, y: e.clientY }; }, { passive: true });

let handedOver = false;
const loop = startLoop((dt) => {
  if (handedOver) return 1;
  if (document.documentElement.dataset.kittyNextDoor) {
    handedOver = true;
    cat.destroy();
    bubble.destroy();
    queueMicrotask(() => loop.stop());
    return 1;
  }
  cat.brain.update(dt, { cursor, hovering: cat.hovering, width: innerWidth, groundY: innerHeight, idleSeconds: 0, hour: new Date().getHours() });
  cat.render();
  cat.updateHover(cursor);
  if (!greeted && visit && cat.brain.activity !== "walk") {
    greeted = true;
    bubble.show([`${GIFTS[visit.gift]} Hi! I'm ${visit.name}.`, "Pet me! (rub your mouse on me)"], 7000);
  }
  bubble.follow(cat.headTop.x, cat.headTop.y);
  return cat.brain.fps;
});
