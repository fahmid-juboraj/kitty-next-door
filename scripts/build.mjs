import { build } from "esbuild";
import { cpSync } from "node:fs";

const common = { bundle: true, sourcemap: true, logLevel: "warning" };

await Promise.all([
  build({
    ...common,
    entryPoints: ["src/main/main.ts", "src/main/preload.ts"],
    outdir: "dist",
    platform: "node",
    format: "cjs",
    external: ["electron"],
  }),
  build({
    ...common,
    entryPoints: ["src/renderer/app.ts", "src/renderer/gallery.ts"],
    outdir: "dist",
    platform: "browser",
    format: "iife",
  }),
]);

for (const f of ["index.html", "gallery.html"]) cpSync(`src/renderer/${f}`, `dist/${f}`);
