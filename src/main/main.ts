import { app, BrowserWindow, ipcMain, Menu, nativeImage, powerMonitor, screen, Tray } from "electron";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.join(__dirname, "..");
const galleryMode = process.argv.includes("--gallery");
// Runs the real overlay off-screen, saves a few frames and resource stats, then quits.
const selfTest = process.argv.includes("--selftest");
const demoMode = process.argv.includes("--demo");

// Fixed ID: Windows uses it for the taskbar identity and as the name of the
// "Start with Windows" registry entry, which the uninstaller removes (build/installer.nsh).
export const APP_ID = "io.github.fahmid-juboraj.kittynextdoor";
app.setAppUserModelId(APP_ID);

let overlay: BrowserWindow | null = null;
let tray: Tray | null = null;
let cursorTimer: NodeJS.Timeout | null = null;

function workArea() {
  return screen.getPrimaryDisplay().workArea;
}

function createOverlay(): void {
  const area = workArea();
  overlay = new BrowserWindow({
    x: area.x,
    y: area.y,
    width: area.width,
    height: area.height,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    // Clicking the cat must not steal focus from whatever the user is working in.
    focusable: false,
    alwaysOnTop: true,
    backgroundColor: "#00000000",
    show: !selfTest,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      offscreen: selfTest,
    },
  });
  overlay.setAlwaysOnTop(true, "screen-saver");
  overlay.setIgnoreMouseEvents(true, { forward: true });
  overlay.loadFile(path.join(__dirname, "index.html"), demoMode ? { query: { demo: "1" } } : undefined);

  // Global cursor position drives the eyes and hit-testing; it needs no permissions.
  let lastX = NaN, lastY = NaN;
  cursorTimer = setInterval(() => {
    if (!overlay || overlay.isDestroyed()) return;
    const p = screen.getCursorScreenPoint();
    if (p.x === lastX && p.y === lastY) return;
    lastX = p.x;
    lastY = p.y;
    const a = workArea();
    overlay.webContents.send("cursor", p.x - a.x, p.y - a.y);
  }, 33);

  // Test harness hook: mirror the cat's state to a file so an external script can drive it.
  const statePath = process.env.PET2_TEST_STATE;
  if (statePath) {
    setInterval(async () => {
      if (!overlay || overlay.isDestroyed()) return;
      const d = await overlay.webContents.executeJavaScript("window.__debug()");
      const a = workArea();
      const scale = screen.getPrimaryDisplay().scaleFactor;
      writeFileSync(statePath, JSON.stringify({ ...d, workArea: a, scale, hwnd: overlay.getNativeWindowHandle().readBigUInt64LE().toString() }));
    }, 100);
  }

  screen.on("display-metrics-changed", () => {
    if (!overlay) return;
    const a = workArea();
    overlay.setBounds(a);
    overlay.webContents.send("bounds", a.width, a.height);
  });
}

function createTray(): void {
  const iconPath = path.join(root, "assets", "icon-32.png");
  const icon = existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
    : nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip("Kitty Next Door");
  const rebuild = () => {
    const visible = overlay?.isVisible() ?? false;
    tray?.setContextMenu(Menu.buildFromTemplate([
      {
        label: visible ? "Hide cat" : "Show cat",
        click: () => {
          if (visible) overlay?.hide();
          else overlay?.showInactive();
          rebuild();
        },
      },
      {
        label: "Start with Windows",
        type: "checkbox",
        checked: app.getLoginItemSettings().openAtLogin,
        click: (item) => {
          // In development the exe is electron.exe, so it also needs the app path.
          app.setLoginItemSettings({
            openAtLogin: item.checked,
            path: process.execPath,
            args: app.isPackaged ? [] : [app.getAppPath()],
          });
          rebuild();
        },
      },
      { type: "separator" },
      { label: "Quit", click: () => app.quit() },
    ]));
  };
  rebuild();
}

function runGallery(): void {
  const win = new BrowserWindow({
    show: false,
    width: 1400,
    height: 1000,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true },
  });
  ipcMain.handle("save-png", (_e, name: string, dataUrl: string) => {
    if (!/^[\w-]+\/[\w-]+\.png$/.test(name)) throw new Error(`bad name ${name}`);
    const out = path.join(root, name);
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, Buffer.from(dataUrl.split(",")[1], "base64"));
  });
  ipcMain.on("gallery-done", () => app.quit());
  win.loadFile(path.join(__dirname, "gallery.html"));
}

async function runSelfTest(): Promise<void> {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const outDir = path.join(root, "art");
  mkdirSync(outDir, { recursive: true });
  await wait(3000);
  app.getAppMetrics(); // start the CPU measurement window
  for (let i = 1; i <= 4; i++) {
    await wait(2500);
    if (!overlay) break;
    const r = (await overlay.webContents.executeJavaScript("window.__debug()")).rect;
    const img = await overlay.webContents.capturePage(r);
    writeFileSync(path.join(outDir, `selftest-${i}.png`), img.toPNG());
  }
  const metrics = app.getAppMetrics().map((m) => ({
    type: m.type,
    memMB: Math.round(m.memory.workingSetSize / 1024),
    cpuPct: Math.round(m.cpu.percentCPUUsage * 10) / 10,
  }));
  const totalMB = metrics.reduce((s, m) => s + m.memMB, 0);
  console.log(JSON.stringify({ totalMB, metrics }, null, 1));
  app.quit();
}

if (!galleryMode && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(() => {
    if (galleryMode) return runGallery();

    ipcMain.handle("idle-seconds", () => powerMonitor.getSystemIdleTime());
    ipcMain.on("click-through", (_e, through: boolean) => {
      overlay?.setIgnoreMouseEvents(through, { forward: true });
    });
    ipcMain.on("show-menu", () => {
      if (!overlay) return;
      Menu.buildFromTemplate([
        { label: "Kitty Next Door", enabled: false },
        { type: "separator" },
        { label: "Quit", click: () => app.quit() },
      ]).popup({ window: overlay });
    });

    createOverlay();
    if (selfTest) runSelfTest();
    else createTray();
  });

  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", () => {
    if (cursorTimer) clearInterval(cursorTimer);
  });
}
