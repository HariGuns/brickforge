/**
 * BrickForge desktop app: runs the Next.js standalone server on a free local
 * port with Electron's own Node, and shows it in a window. Closing the window
 * stops the server. Settings, builds, runs, exports and logs live in the user
 * data folder (~/.config/BrickForge); the API key is never bundled.
 */
const { app, BrowserWindow, Menu, dialog, shell } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

app.setName("BrickForge");
if (!app.requestSingleInstanceLock()) app.exit(0);

const dataDir = app.getPath("userData");
const logDir = path.join(dataDir, "logs");
const serverDir = app.isPackaged ? path.join(process.resourcesPath, "server") : path.join(__dirname, "..", ".next-app", "standalone");
const iconPath = path.join(__dirname, "icon.png");
const readJson = (f) => {
  try {
    return JSON.parse(fs.readFileSync(f, "utf8"));
  } catch {
    return {};
  }
};
/** Written at package time: the source folder to offer for importing existing builds. */
const buildInfo = readJson(path.join(__dirname, "build-info.json"));

let server = null;
let win = null;
let quitting = false;

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

function ping(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => (res.resume(), resolve(res.statusCode === 200)));
    req.on("error", () => resolve(false));
    req.setTimeout(2000, () => (req.destroy(), resolve(false)));
  });
}

async function startServer() {
  fs.mkdirSync(logDir, { recursive: true });
  const log = fs.openSync(path.join(logDir, "server.log"), "a");
  fs.writeSync(log, `\n--- ${new Date().toISOString()} BrickForge ${app.getVersion()} ---\n`);
  const port = await freePort();
  const env = { ...process.env };
  // A stray NODE_OPTIONS or dev settings from the shell shouldn't leak into the bundled server.
  for (const k of ["NODE_OPTIONS", "NODE_ENV", "PORT", "HOSTNAME", "BRICKFORGE_PORT"]) delete env[k];
  server = spawn(process.execPath, [path.join(serverDir, "server.js")], {
    cwd: serverDir,
    env: {
      ...env,
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      NEXT_TELEMETRY_DISABLED: "1",
      BRICKFORGE_DATA_DIR: dataDir,
      BRICKFORGE_CONFIG_DIR: dataDir,
      ...(buildInfo.importFrom ? { BRICKFORGE_IMPORT_FROM: buildInfo.importFrom } : {}),
    },
    stdio: ["ignore", log, log],
  });
  server.on("exit", (code, signal) => {
    server = null;
    if (quitting) return;
    dialog.showErrorBox("BrickForge stopped", `The BrickForge server exited (${signal ?? `code ${code}`}).\n\nDetails are in ${path.join(logDir, "server.log")}`);
    app.quit();
  });
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 120; i++) {
    if (!server) throw new Error("The server exited while starting.");
    if (await ping(`${url}/api/settings`)) return url;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("The server didn't start within 30 seconds.");
}

function stopServer() {
  if (!server) return;
  const s = server;
  s.kill("SIGTERM");
  setTimeout(() => s.exitCode === null && s.signalCode === null && s.kill("SIGKILL"), 3000).unref();
}

/** App-menu entry for the AppImage (KDE, GNOME…), refreshed if the AppImage moves. */
function installDesktopEntry() {
  const appImage = process.env.APPIMAGE;
  if (!appImage || process.env.BRICKFORGE_NO_DESKTOP_ENTRY) return;
  try {
    const share = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
    const iconDir = path.join(share, "icons", "hicolor", "512x512", "apps");
    fs.mkdirSync(iconDir, { recursive: true });
    fs.copyFileSync(iconPath, path.join(iconDir, "brickforge.png"));
    fs.chmodSync(path.join(iconDir, "brickforge.png"), 0o644);
    const q = (s) => `"${s.replace(/(["`$\\])/g, "\\$1")}"`;
    const entry = [
      "[Desktop Entry]",
      "Type=Application",
      "Name=BrickForge",
      "GenericName=Brick model designer",
      "Comment=Turn a description or photo into a buildable brick model",
      `Exec=${q(appImage)} %U`,
      `TryExec=${appImage}`,
      "Icon=brickforge",
      "Terminal=false",
      "Categories=Graphics;3DGraphics;",
      "StartupWMClass=BrickForge",
      "StartupNotify=true",
      "",
    ].join("\n");
    const file = path.join(share, "applications", "brickforge-app.desktop");
    let current = "";
    try {
      current = fs.readFileSync(file, "utf8");
    } catch {}
    if (current === entry) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, entry, { mode: 0o755 });
    // Ask KDE / other desktops to pick it up now rather than at next login.
    for (const cmd of ["kbuildsycoca6", "kbuildsycoca5", "update-desktop-database"]) {
      const p = spawn(cmd, cmd.startsWith("update") ? [path.dirname(file)] : [], { stdio: "ignore", detached: true });
      p.on("error", () => {});
      p.unref();
    }
  } catch (e) {
    console.error("Couldn't install the menu entry:", e);
  }
}

const LOADING = `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><title>BrickForge</title>
<body style="margin:0;height:100vh;display:grid;place-items:center;background:#cdd6c6;font:600 15px system-ui;color:#1c1d1c">
<div style="display:flex;gap:12px;align-items:center"><svg width="28" height="28" viewBox="0 0 24 24"><rect x="2" y="9" width="20" height="12" rx="3" fill="#dd4b25"/><rect x="5" y="5" width="5" height="5" rx="1.5" fill="#dd4b25"/><rect x="14" y="5" width="5" height="5" rx="1.5" fill="#dd4b25"/></svg>Starting BrickForge…</div>`)}`;

async function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 380,
    minHeight: 500,
    title: "BrickForge",
    icon: iconPath,
    backgroundColor: "#cdd6c6",
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  });
  win.on("page-title-updated", (e) => e.preventDefault());
  win.on("closed", () => {
    win = null;
    app.quit();
  });
  await win.loadURL(LOADING);

  let url;
  try {
    url = await startServer();
  } catch (e) {
    dialog.showErrorBox("BrickForge couldn't start", `${e.message}\n\nDetails are in ${path.join(logDir, "server.log")}`);
    app.quit();
    return;
  }
  const own = (u) => u.startsWith(`${url}/`) || u === url;
  // Links out of the app (API console, docs) open in the normal browser.
  win.webContents.setWindowOpenHandler(({ url: u }) => {
    if (/^https?:/.test(u) && !own(u)) shell.openExternal(u);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, u) => {
    if (!own(u)) {
      e.preventDefault();
      if (/^https?:/.test(u)) shell.openExternal(u);
    }
  });
  if (win) await win.loadURL(url);
}

Menu.setApplicationMenu(
  Menu.buildFromTemplate([
    { label: "File", submenu: [{ role: "quit" }] },
    { role: "editMenu" },
    { label: "View", submenu: [{ role: "reload" }, { role: "toggleDevTools" }, { type: "separator" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" }, { role: "togglefullscreen" }] },
  ]),
);

app.on("second-instance", () => {
  if (win) (win.isMinimized() && win.restore(), win.focus());
});
app.on("before-quit", () => {
  quitting = true;
  stopServer();
});
app.on("window-all-closed", () => app.quit());
process.on("SIGTERM", () => app.quit());
process.on("SIGINT", () => app.quit());

app.whenReady().then(() => {
  installDesktopEntry();
  createWindow();
});
