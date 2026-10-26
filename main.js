const { app, BrowserWindow, ipcMain, dialog, Menu } = require("electron");
const path = require("path");
const fs = require("fs");
const { createStore } = require("./store");

const DEFAULT_DIR = () => path.join(app.getPath("documents"), "Haftalik-Plan");
const DEFAULT_FILE = () => path.join(DEFAULT_DIR(), "Haftalik-Plan-Verisi.json");
const DB_FILE = () => path.join(DEFAULT_DIR(), "Haftalik-Plan.db");
const CFG = () => path.join(app.getPath("userData"), "config.json");
const FILTERS = [{ name: "Haftalık Plan verisi", extensions: ["json"] }];

let win = null;
let current = null;
let lastBak = 0;
let store = null;
let storeError = "";

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

async function initStore() {
  try {
    const initSqlJs = require("sql.js");
    const wasmPath = path.join(path.dirname(require.resolve("sql.js")), "sql-wasm.wasm");
    const SQL = await initSqlJs({
      wasmBinary: fs.readFileSync(wasmPath),
      locateFile: (f) => path.join(path.dirname(wasmPath), f)
    });
    const legacy = [readCfg().file, DEFAULT_FILE()].filter((v, i, a) => v && a.indexOf(v) === i);
    const st = createStore(SQL, DB_FILE(), legacy);
    st.init();
    store = st;
  } catch (e) {
    store = null;
    storeError = String((e && e.message) || e);
  }
}

function initInfo() {
  if (store) {
    const s = store.snapshot();
    return { mode: "sqlite", path: DB_FILE(), name: path.basename(DB_FILE()), text: s.text, savedAt: s.savedAt };
  }
  const p = curPath();
  let text = null;
  try { text = fs.readFileSync(p, "utf8"); } catch (e) { text = null; }
  return { mode: "json", error: storeError, path: p, name: path.basename(p), text, savedAt: 0 };
}

function persistText(text) {
  if (store) {
    store.write(text);
    return { ok: true, path: DB_FILE(), name: path.basename(DB_FILE()) };
  }
  const p = curPath();
  safeWrite(p, String(text));
  return result(p);
}

function focusWin() {
  try { if (win) { win.focus(); win.webContents.focus(); } } catch (e) { /* yoksay */ }
}

ipcMain.handle("agenda:init", () => initInfo());
ipcMain.on("agenda:initSync", (e) => {
  try { e.returnValue = initInfo(); } catch (err) { e.returnValue = null; }
});

ipcMain.handle("agenda:write", (e, text) => {
  try {
    return persistText(text);
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

ipcMain.on("agenda:writeSync", (e, text) => {
  try { persistText(text); e.returnValue = true; }
  catch (err) { e.returnValue = false; }
});

ipcMain.handle("agenda:open", async () => {
  const r = await dialog.showOpenDialog(win, {
    properties: ["openFile"],
    filters: FILTERS,
    defaultPath: DEFAULT_DIR()
  });
  focusWin();
  if (r.canceled || !r.filePaths.length) return { ok: false };
  const p = r.filePaths[0];
  try {
    return { ok: true, path: p, name: path.basename(p), text: fs.readFileSync(p, "utf8") };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

ipcMain.handle("agenda:use", (e, p) => {
  if (store) return true; // SQLite modunda etkin kayıt her zaman Haftalik-Plan.db
  if (typeof p === "string" && p) setPath(p);
  return true;
});

ipcMain.handle("agenda:saveAs", async (e, text) => {
  const d = new Date();
  const p2 = (n) => String(n).padStart(2, "0");
  const name = "Haftalik-Plan-Yedek-" + d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate()) + ".json";
  const r = await dialog.showSaveDialog(win, {
    defaultPath: path.join(DEFAULT_DIR(), name),
    filters: FILTERS
  });
  focusWin();
  if (r.canceled || !r.filePath) return { ok: false };
  try {
    safeWrite(r.filePath, String(text));
    if (store) return { ok: true, path: DB_FILE(), name: path.basename(DB_FILE()), backup: r.filePath };
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

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  await initStore();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
