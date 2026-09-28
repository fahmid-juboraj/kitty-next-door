// Where visit links point. The landing page in `site/` is published here
// (GitHub Pages). Override at build time with KITTY_VISIT_BASE.
declare const __VISIT_BASE__: string;

export const VISIT_BASE: string =
  typeof __VISIT_BASE__ === "string" ? __VISIT_BASE__ : "https://fahmid-juboraj.github.io/kitty-next-door/visit/";

export const REPO_URL = "https://github.com/fahmid-juboraj/kitty-next-door";

/** A visiting cat stays this long before walking home. */
export const GUEST_STAY_MS = 24 * 60 * 60 * 1000;
