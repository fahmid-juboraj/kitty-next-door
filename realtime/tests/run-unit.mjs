// Bundles the TypeScript unit tests and runs them with node:test.
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const files = ["core", "protocol", "badges"];
for (const f of files) {
  await build({
    entryPoints: [path.join(here, `${f}.test.ts`)], outfile: path.join(here, "..", "dist-test", `${f}.test.mjs`),
    bundle: true, platform: "node", format: "esm", logLevel: "warning",
  });
}
const r = spawnSync(process.execPath, ["--test", ...files.map((f) => path.join(here, "..", "dist-test", `${f}.test.mjs`))], { stdio: "inherit" });
process.exit(r.status ?? 1);
