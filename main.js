const { app, BrowserWindow, ipcMain, dialog, Menu } = require("electron");
const path = require("path");
const fs = require("fs");

const DEFAULT_DIR = () => path.join(app.getPath("documents"), "Haftalik-Plan");
const DEFAULT_FILE = () => path.join(DEFAULT_DIR(), "Haftalik-Plan-Verisi.json");
const CFG = () => path.join(app.getPath("userData"), "config.json");
const FILTERS = [{ name: "Haftalık Plan verisi", extensions: ["json"] }];

let win = null;
let current = null;
let lastBak = 0;

function readCfg() {
  try { return JSON.parse(fs.readFileSync(CFG(), "utf8")); } catch (e) { return {}; }
}
function writeCfg(c) {
  try {
    fs.mkdirSync(path.dirname(CFG()), { recursive: true });
    fs.writeFileSync(CFG(), JSON.stringify(c));
  } catch (e) { /* yoksay */ }
}
function curPath() {
  if (!current) current = readCfg().file || DEFAULT_FILE();
  return current;
}
function setPath(p) {
  current = p;
  const c = readCfg();
  c.file = p;
  writeCfg(c);
}
function safeWrite(p, text) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  // Önceki sürümü en fazla 5 dakikada bir .bak olarak sakla
  if (fs.existsSync(p) && Date.now() - lastBak > 5 * 60 * 1000) {
    try { fs.copyFileSync(p, p + ".bak"); lastBak = Date.now(); } catch (e) { /* yoksay */ }
  }
  const tmp = p + ".tmp";
  try {
    fs.writeFileSync(tmp, text, "utf8");
    fs.renameSync(tmp, p);
  } catch (e) {
    fs.writeFileSync(p, text, "utf8");
  }
}
function result(p) {
  return { ok: true, path: p, name: path.basename(p) };
}

ipcMain.handle("agenda:init", () => {
  const p = curPath();
  let text = null;
  try { text = fs.readFileSync(p, "utf8"); } catch (e) { text = null; }
  return { path: p, name: path.basename(p), text };
});

ipcMain.handle("agenda:write", (e, text) => {
  try {
    const p = curPath();
    safeWrite(p, String(text));
    return result(p);
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

ipcMain.on("agenda:writeSync", (e, text) => {
  try { safeWrite(curPath(), String(text)); e.returnValue = true; }
  catch (err) { e.returnValue = false; }
});

ipcMain.handle("agenda:open", async () => {
  const r = await dialog.showOpenDialog(win, {
    properties: ["openFile"],
    filters: FILTERS,
    defaultPath: DEFAULT_DIR()
  });
  if (r.canceled || !r.filePaths.length) return { ok: false };
  const p = r.filePaths[0];
  try {
    return { ok: true, path: p, name: path.basename(p), text: fs.readFileSync(p, "utf8") };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

ipcMain.handle("agenda:use", (e, p) => {
  if (typeof p === "string" && p) setPath(p);
  return true;
});

ipcMain.handle("agenda:saveAs", async (e, text) => {
  const r = await dialog.showSaveDialog(win, {
    defaultPath: curPath(),
    filters: FILTERS
  });
  if (r.canceled || !r.filePath) return { ok: false };
  try {
    safeWrite(r.filePath, String(text));
    setPath(r.filePath);
    return result(r.filePath);
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

function createWindow() {
  win = new BrowserWindow({
    width: 1320,
    height: 900,
    title: "Haftalık Planlayıcı",
    icon: path.join(__dirname, "build", "icon.ico"),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile(path.join(__dirname, "index.html"));
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
