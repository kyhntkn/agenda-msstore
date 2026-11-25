const { app, BrowserWindow, ipcMain, dialog, Menu, Tray, Notification, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const { createStore } = require("./store");

const DEFAULT_DIR = () => path.join(app.getPath("documents"), "Haftalik-Plan");
const DEFAULT_FILE = () => path.join(DEFAULT_DIR(), "Haftalik-Plan-Verisi.json");
const DB_FILE = () => path.join(DEFAULT_DIR(), "Haftalik-Plan.db");
const CFG = () => path.join(app.getPath("userData"), "config.json");
const FILTERS = [{ name: "Haftalık Plan verisi", extensions: ["json"] }];

let win = null;
let tray = null;
let quitting = false;
const STORE = !!process.windowsStore;
const HIDDEN = process.argv.includes("--hidden");
const LOGIN_ARGS = ["--hidden"];
const ICON = () => path.join(__dirname, "build", "icon.ico");
const toasts = new Set();
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

function trayEnabled() { return readCfg().tray !== false; }

function showWin() {
  if (!win) { createWindow(true); return; }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function autostartOn() {
  if (STORE || process.platform !== "win32") return null; // Store: Windows Ayarlarindan yonetilir
  try { return !!app.getLoginItemSettings({ args: LOGIN_ARGS }).openAtLogin; } catch (e) { return false; }
}
function setAutostart(on) {
  if (STORE || process.platform !== "win32" || !app.isPackaged) return;
  try { app.setLoginItemSettings({ openAtLogin: !!on, args: LOGIN_ARGS }); } catch (e) { /* yoksay */ }
}

function buildTray() {
  if (tray || !trayEnabled()) return;
  try {
    tray = new Tray(ICON());
    tray.setToolTip("Haftalık Planlayıcı");
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: "Planlayıcıyı aç", click: showWin },
      { type: "separator" },
      { label: "Çıkış", click: () => { quitting = true; app.quit(); } }
    ]));
    tray.on("click", showWin);
  } catch (e) { tray = null; }
}
function dropTray() {
  if (tray) { try { tray.destroy(); } catch (e) { /* yoksay */ } tray = null; }
}

function toast(title, body, target) {
  if (!Notification.isSupported()) return false;
  const n = new Notification({ title: String(title || ""), body: String(body || ""), icon: ICON() });
  toasts.add(n);
  n.on("click", () => {
    showWin();
    if (win && target) win.webContents.send("agenda:goto", target);
  });
  n.on("close", () => toasts.delete(n));
  setTimeout(() => toasts.delete(n), 10 * 60 * 1000);
  n.show();
  return true;
}

ipcMain.handle("agenda:notify", (e, o) => {
  try { return toast(o && o.title, o && o.body, o && o.target); } catch (err) { return false; }
});
ipcMain.handle("agenda:settings", () => ({ tray: trayEnabled(), autostart: autostartOn(), store: STORE, platform: process.platform }));
ipcMain.handle("agenda:setSetting", (e, k, v) => {
  const c = readCfg();
  if (k === "tray") {
    c.tray = !!v; writeCfg(c);
    if (v) buildTray(); else dropTray();
  } else if (k === "autostart") {
    if (STORE) shell.openExternal("ms-settings:startupapps");
    else setAutostart(!!v);
  }
  return { tray: trayEnabled(), autostart: autostartOn(), store: STORE, platform: process.platform };
});

function createWindow(forceShow) {
  win = new BrowserWindow({
    width: 1320,
    height: 900,
    show: forceShow || !(HIDDEN && trayEnabled() && tray),
    title: "Haftalık Planlayıcı",
    icon: ICON(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });
  win.loadFile(path.join(__dirname, "index.html"));
  win.on("close", (e) => {
    if (quitting || !trayEnabled() || !tray) return;
    e.preventDefault();
    win.hide();
    const c = readCfg();
    if (!c.trayHinted) {
      c.trayHinted = true; writeCfg(c);
      toast("Haftalık Planlayıcı arka planda çalışıyor", "Hatırlatmalar gelmeye devam edecek. Tamamen kapatmak için sistem tepsisindeki simgeye sağ tıklayıp Çıkış'ı seç.");
    }
  });
  // Windows oturumu kapanirken/yeniden baslarken tepsiye gizlenme kapanisi engellemesin
  win.on("query-session-end", () => { quitting = true; });
  win.on("session-end", () => { quitting = true; });
  win.on("closed", () => { win = null; });
}

if (process.platform === "win32" && !STORE) app.setAppUserModelId("com.haftalikplan.app");

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => showWin());
  app.on("before-quit", () => { quitting = true; });

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    // Ilk calistirmada "Windows ile baslat" varsayilan olarak acik
    const c = readCfg();
    if (!c.autostartInit) {
      setAutostart(true);
      c.autostartInit = true;
      writeCfg(c);
    }
    await initStore();
    buildTray();
    createWindow(false);
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow(true); else showWin();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
