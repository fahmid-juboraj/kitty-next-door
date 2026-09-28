// Builds the browser extensions (Chrome/Edge + Firefox), their store zips,
// and the static landing site for visit links.
//   node scripts/build-ext.mjs            -> dist-ext/{chrome,firefox}, dist-ext/*.zip, dist-site/
//   KITTY_VISIT_BASE=<url> node ...        -> point visit links somewhere else (tests, forks)
import { build } from "esbuild";
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { deflateRawSync } from "node:zlib";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const visitBase = process.env.KITTY_VISIT_BASE ?? "https://kitty-next-door.kittynextdoor.workers.dev/visit/";
const define = { __VISIT_BASE__: JSON.stringify(visitBase) };
const common = { bundle: true, format: "iife", platform: "browser", target: "es2022", define, logLevel: "warning" };

const description = "A cat that lives on your web pages, keeps you company, and can visit your friends.";
const icons = { 16: "icons/icon-16.png", 48: "icons/icon-48.png", 128: "icons/icon-128.png" };

function manifest(browser) {
  const m = {
    manifest_version: 3,
    name: "Kitty Next Door",
    version: pkg.version,
    description,
    icons,
    action: { default_popup: "popup.html", default_icon: icons, default_title: "Kitty Next Door" },
    permissions: ["storage", "idle", "activeTab"],
    content_scripts: [
      { matches: ["http://*/*", "https://*/*"], js: ["content.js"], run_at: "document_idle", all_frames: false },
    ],
  };
  if (browser === "firefox") {
    m.background = { scripts: ["background.js"] };
    m.browser_specific_settings = {
      gecko: {
        id: "kitty-next-door@fahmid-juboraj.github.io",
        strict_min_version: "140.0",
        // Nothing leaves the browser: no analytics, no network requests.
        data_collection_permissions: { required: ["none"] },
      },
    };
  } else {
    m.background = { service_worker: "background.js" };
    m.minimum_chrome_version = "116";
  }
  return m;
}

rmSync("dist-ext", { recursive: true, force: true });
rmSync("dist-site", { recursive: true, force: true });

for (const browser of ["chrome", "firefox"]) {
  const out = path.join("dist-ext", browser);
  await build({
    ...common,
    entryPoints: { content: "src/ext/content.ts", background: "src/ext/background.ts", popup: "src/ext/popup.ts" },
    outdir: out,
  });
  cpSync("src/ext/popup.html", path.join(out, "popup.html"));
  mkdirSync(path.join(out, "icons"), { recursive: true });
  for (const size of [16, 48, 128]) cpSync(`assets/icon-${size}.png`, path.join(out, `icons/icon-${size}.png`));
  cpSync("LICENSE", path.join(out, "LICENSE"));
  writeFileSync(path.join(out, "manifest.json"), JSON.stringify(manifest(browser), null, 2) + "\n");
  writeZip(out, path.join("dist-ext", `kitty-next-door-${browser}-${pkg.version}.zip`));
}

// Landing site (served by the Cloudflare Worker in realtime/server): / and /visit/
const site = new URL("../", visitBase).href;
const repo = "https://github.com/fahmid-juboraj/kitty-next-door";
// Every install button points at its own section of the README until the store listings exist.
const links = {
  SITE: site,
  REPO: repo,
  CHROME: `${repo}#install-on-chrome`,
  EDGE: `${repo}#install-on-microsoft-edge`,
  FIREFOX: `${repo}#install-on-firefox`,
  WINDOWS: `${repo}#install-the-windows-app`,
  PRIVACY: `${repo}/blob/main/realtime/PRIVACY.md`,
};
const fill = (html) => html.replace(/%([A-Z]+)%/g, (m, k) => {
  if (!(k in links)) throw new Error(`unknown placeholder ${m}`);
  return links[k];
});
mkdirSync("dist-site/visit", { recursive: true });
await build({ ...common, entryPoints: { visit: "src/site/visit.ts" }, outdir: "dist-site/visit" });
await build({ ...common, entryPoints: { home: "src/site/home.ts" }, outdir: "dist-site" });
writeFileSync("dist-site/visit/index.html", fill(readFileSync("src/site/visit.html", "utf8")));
writeFileSync("dist-site/index.html", fill(readFileSync("src/site/index.html", "utf8")));
cpSync("art/hero.png", "dist-site/hero.png");
cpSync("art/og.png", "dist-site/og.png");
cpSync("assets/icon-48.png", "dist-site/icon-48.png");

console.log(`extensions + site built (visit links -> ${visitBase})`);

// ---- minimal zip writer (deflate), forward-slash paths as stores require ----
function writeZip(dir, outFile) {
  const files = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const full = path.join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else files.push(full);
    }
  };
  walk(dir);
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const full of files) {
    const name = Buffer.from(path.relative(dir, full).split(path.sep).join("/"));
    const data = readFileSync(full);
    const comp = deflateRawSync(data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(0x00210000, 10); // 1980-01-01, fixed for reproducible zips
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, comp);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(0x00210000, 12);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + comp.length;
  }
  const cdSize = centrals.reduce((s, b) => s + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cdSize, 12);
  end.writeUInt32LE(offset, 16);
  writeFileSync(outFile, Buffer.concat([...locals, ...centrals, end]));
}

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
