// Packs the source needed to rebuild Kitty Next Door Live, for store review
// (addons.mozilla.org requires it for bundled code). Output:
//   release-upload/kitty-next-door-live-source-<version>.zip
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const version = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version;
const esbuild = JSON.parse(readFileSync(path.join(root, "node_modules/esbuild/package.json"), "utf8")).version;
const stage = mkdtempSync(path.join(os.tmpdir(), "kitty-src-"));

const copy = (rel) => cpSync(path.join(root, rel), path.join(stage, rel), { recursive: true });
for (const rel of [
  // tsconfig files change esbuild's output ("use strict"), so they're part of the source.
  "LICENSE", "tsconfig.json", "realtime/tsconfig.json", "src/core", "src/web", "src/ext/api.ts", "src/ext/state.ts",
  "realtime/shared", "realtime/PRIVACY.md", "realtime/extension/build.mjs", "realtime/extension/src",
  "assets/icon-16.png", "assets/icon-48.png", "assets/icon-128.png",
]) copy(rel);
cpSync(path.join(root, "realtime/extension/SOURCE-BUILD.md"), path.join(stage, "README.md"));
writeFileSync(path.join(stage, "package.json"), JSON.stringify({
  name: "kitty-next-door-live-source", version, private: true, license: "SEE LICENSE IN LICENSE",
  scripts: { build: "node realtime/extension/build.mjs --prod" },
  devDependencies: { esbuild },
}, null, 2) + "\n");
execFileSync("npm", ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: stage, stdio: "ignore", shell: true });

mkdirSync(path.join(root, "release-upload"), { recursive: true });
const zip = path.join(root, "release-upload", `kitty-next-door-live-source-${version}.zip`);
rmSync(zip, { force: true });
// Forward-slash paths, sorted, so the archive is the same on every OS.
execFileSync("python", ["-c", `
import os, sys, zipfile
stage, out = sys.argv[1], sys.argv[2]
files = sorted(os.path.relpath(os.path.join(d, f), stage) for d, _, fs in os.walk(stage) for f in fs)
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for rel in files:
        z.write(os.path.join(stage, rel), rel.replace(os.sep, "/"))
`, stage, zip]);
console.log(zip);
console.log(stage);
