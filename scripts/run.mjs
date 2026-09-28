// Launch Electron with ELECTRON_RUN_AS_NODE cleared; some hosts (e.g. VS Code
// extensions) set it, which makes Electron behave like plain Node.
import { spawn } from "node:child_process";
import electron from "electron";

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
// A leading .cjs argument runs that script as the Electron entry (test harnesses).
const args = process.argv.slice(2);
const entry = args[0]?.endsWith(".cjs") ? args.shift() : ".";
const child = spawn(electron, [entry, ...args], { stdio: "inherit", env });
child.on("exit", (code) => process.exit(code ?? 0));
