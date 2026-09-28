// Builds Kitty Next Door Live for Chrome, Edge and Firefox, plus store zips.
//   node build.mjs                          -> dev build, server ws://127.0.0.1:8787
//   node build.mjs --prod                    -> production build (the deployed Worker)
//   KITTY_SERVER=wss://<host> node build.mjs -> any other server
import { build } from "esbuild";
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, "..", "..");
const dist = path.join(here, "dist");
const pkg = JSON.parse(readFileSync(path.join(repo, "package.json"), "utf8"));
const PROD_SERVER = "wss://kitty-next-door.kittynextdoor.workers.dev";
const server = (process.env.KITTY_SERVER ?? (process.argv.includes("--prod") ? PROD_SERVER : "ws://127.0.0.1:8787")).replace(/\/+$/, "");
if (!/^wss?:\/\/[^/]+$/.test(server)) throw new Error(`KITTY_SERVER must look like wss://host, got ${server}`);
const insecureDev = server.startsWith("ws://");

const icons = { 16: "icons/icon-16.png", 48: "icons/icon-48.png", 128: "icons/icon-128.png" };
const description = "A cat that keeps you company on every page, and really walks over to visit your friends.";

function manifest(browser) {
  const m = {
    manifest_version: 3,
    name: "Kitty Next Door Live",
    short_name: "Kitty Live",
    version: pkg.version,
    description,
    icons,
    action: { default_popup: "popup.html", default_icon: icons, default_title: "Kitty Next Door Live" },
    permissions: ["storage", "idle", "activeTab", "alarms"],
    content_scripts: [
      { matches: ["http://*/*", "https://*/*"], js: ["content.js"], run_at: "document_idle", all_frames: false },
    ],
  };
  if (browser === "firefox") {
    m.background = { scripts: ["background.js"] };
    m.browser_specific_settings = {
      gecko: {
        id: "kitty-next-door-live@fahmid-juboraj.github.io",
        strict_min_version: "140.0",
        // Sent to the server so friends can see them: names and visit notes.
        data_collection_permissions: { required: ["personallyIdentifyingInfo", "personalCommunications"] },
      },
    };
    // Firefox's default MV3 policy upgrades ws:// to wss://, which breaks the local dev server.
    if (insecureDev) m.content_security_policy = { extension_pages: "script-src 'self'; object-src 'self';" };
  } else {
    m.background = { service_worker: "background.js" };
    // 116+: an open WebSocket keeps the service worker alive.
    m.minimum_chrome_version = "116";
  }
  return m;
}

rmSync(dist, { recursive: true, force: true });
for (const browser of ["chrome", "edge", "firefox"]) {
  const out = path.join(dist, browser);
  await build({
    entryPoints: {
      background: path.join(here, "src/background.ts"),
      content: path.join(here, "src/content.ts"),
      popup: path.join(here, "src/popup.ts"),
    },
    outdir: out,
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
    define: { __SERVER__: JSON.stringify(server) },
    // Fixed working directory, so the output is byte-identical wherever the build runs from
    // (store reviewers rebuild from source and compare).
    absWorkingDir: here,
    logLevel: "warning",
  });
  cpSync(path.join(here, "src/popup.html"), path.join(out, "popup.html"));
  mkdirSync(path.join(out, "icons"), { recursive: true });
  for (const size of [16, 48, 128]) cpSync(path.join(repo, `assets/icon-${size}.png`), path.join(out, `icons/icon-${size}.png`));
  cpSync(path.join(repo, "LICENSE"), path.join(out, "LICENSE"));
  cpSync(path.join(here, "..", "PRIVACY.md"), path.join(out, "PRIVACY.md"));
  writeFileSync(path.join(out, "manifest.json"), JSON.stringify(manifest(browser), null, 2) + "\n");
  writeZip(out, path.join(dist, `kitty-next-door-live-${browser}-${pkg.version}.zip`));
}
console.log(`Kitty Next Door Live built for chrome, edge, firefox (server ${server})`);

// Minimal deflate zip with forward-slash paths, as the stores require.
function writeZip(dir, outFile) {
  const files = [];
  const walk = (d) => readdirSync(d).forEach((n) => {
    const f = path.join(d, n);
    if (statSync(f).isDirectory()) walk(f);
    else files.push(f);
  });
  walk(dir);
  const parts = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(path.relative(dir, f).split(path.sep).join("/"));
    const data = readFileSync(f);
    const comp = deflateRawSync(data);
    const crc = crc32(data);
    const head = (sig, size) => {
      const b = Buffer.alloc(size);
      b.writeUInt32LE(sig, 0);
      return b;
    };
    const local = head(0x04034b50, 30);
    local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(0x00210000, 10); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
    const cd = head(0x02014b50, 46);
    cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(0x0800, 8); cd.writeUInt16LE(8, 10);
    cd.writeUInt32LE(0x00210000, 12); cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(comp.length, 20);
    cd.writeUInt32LE(data.length, 24); cd.writeUInt16LE(name.length, 28); cd.writeUInt32LE(offset, 42);
    parts.push(local, name, comp);
    central.push(cd, name);
    offset += 30 + name.length + comp.length;
  }
  const size = central.reduce((s, b) => s + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(size, 12); end.writeUInt32LE(offset, 16);
  writeFileSync(outFile, Buffer.concat([...parts, ...central, end]));
}

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
