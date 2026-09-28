// The home page's own cat: it walks along the bottom of the page and can be
// petted, picked up and dropped, just like the real one.
import { DEFAULT_COAT } from "../core/coats";
import { CatActor, startLoop } from "../web/actor";

const stage = document.getElementById("stage")!;
const cat = new CatActor(stage, DEFAULT_COAT, {
  x: innerWidth * 0.8, groundY: innerHeight, scale: innerWidth < 600 ? 1.1 : 1.5,
});
cat.brain.enterFrom(1, innerWidth);

let cursor: { x: number; y: number } | null = null;
window.addEventListener("pointermove", (e) => {
  cursor = { x: e.clientX, y: e.clientY };
  cat.updateHover(cursor);
}, { passive: true });

startLoop((dt) => {
  cat.brain.update(dt, {
    cursor, hovering: cat.hovering, width: innerWidth, groundY: innerHeight, idleSeconds: 0, hour: new Date().getHours(),
  });
  cat.render();
  cat.updateHover(cursor);
  return cat.brain.fps;
});

// The "pet the cat" hint only belongs near the top of the page.
const hint = document.getElementById("petHint");
window.addEventListener("scroll", () => hint?.classList.toggle("gone", scrollY > 240), { passive: true });
