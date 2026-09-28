// Launch Electron with ELECTRON_RUN_AS_NODE cleared; some hosts (e.g. VS Code
// extensions) set it, which makes Electron behave like plain Node.
import { spawn } from "node:child_process";
import electron from "electron";

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [".", ...process.argv.slice(2)], { stdio: "inherit", env });
child.on("exit", (code) => process.exit(code ?? 0));
