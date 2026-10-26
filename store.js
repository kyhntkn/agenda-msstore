"use strict";
// SQLite (sql.js / WASM) tabanli yerel kayit katmani.
// Uygulama verisi (anahtar -> deger) "entries" tablosunda, ust bilgiler "meta" tablosunda tutulur.
const fs = require("fs");
const path = require("path");

function createStore(SQL, dbFile, legacyFiles) {
  let db = null;
  let lastBak = 0;

  function persist() {
    const bytes = Buffer.from(db.export());
    if (fs.existsSync(dbFile) && Date.now() - lastBak > 5 * 60 * 1000) {
      try { fs.copyFileSync(dbFile, dbFile + ".bak"); lastBak = Date.now(); } catch (e) { /* yoksay */ }
    }
    const tmp = dbFile + ".tmp";
    try {
      fs.writeFileSync(tmp, bytes);
      fs.renameSync(tmp, dbFile);
    } catch (e) {
      fs.writeFileSync(dbFile, bytes);
    }
  }

  function metaGet(k) {
    const r = db.exec("SELECT v FROM meta WHERE k=?", [k]);
    return r.length && r[0].values.length ? r[0].values[0][0] : null;
  }
  function metaSet(k, v) {
    db.run("INSERT OR REPLACE INTO meta(k,v) VALUES(?,?)", [k, String(v)]);
  }
  function count() {
    const r = db.exec("SELECT count(*) FROM entries");
    return r.length ? Number(r[0].values[0][0]) : 0;
  }

  function writeData(data, savedAt) {
    db.run("BEGIN");
    try {
      db.run("DELETE FROM entries");
      const st = db.prepare("INSERT INTO entries(k,v) VALUES(?,?)");
      try {
        Object.keys(data).forEach((k) => {
          if (data[k] === undefined) return;
          st.run([k, JSON.stringify(data[k])]);
        });
      } finally { st.free(); }
      metaSet("savedAt", savedAt);
      db.run("COMMIT");
    } catch (e) {
      try { db.run("ROLLBACK"); } catch (e2) { /* yoksay */ }
      throw e;
    }
    persist();
  }

  function open() {
    fs.mkdirSync(path.dirname(dbFile), { recursive: true });
    if (fs.existsSync(dbFile)) {
      try {
        db = new SQL.Database(new Uint8Array(fs.readFileSync(dbFile)));
        db.exec("SELECT count(*) FROM sqlite_master");
      } catch (e) {
        try { fs.renameSync(dbFile, dbFile + ".bozuk-" + Date.now()); } catch (e2) { /* yoksay */ }
        db = null;
      }
    }
    if (!db) db = new SQL.Database();
    db.run("CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT)");
    db.run("CREATE TABLE IF NOT EXISTS entries(k TEXT PRIMARY KEY, v TEXT NOT NULL)");
  }

  // Eski surumdeki JSON kaydini bir kez iceri aktar; dosya .eski.json olarak saklanir.
  function migrateLegacy() {
    if (metaGet("legacy_checked")) return;
    if (count() === 0) {
      for (const f of legacyFiles) {
        try {
          if (!f || !fs.existsSync(f)) continue;
          const o = JSON.parse(fs.readFileSync(f, "utf8"));
          if (o && o.app === "haftalik-plan" && o.data && typeof o.data === "object") {
            writeData(o.data, o.savedAt || Date.now());
            try { fs.renameSync(f, f.replace(/\.json$/i, "") + ".eski.json"); } catch (e) { /* yoksay */ }
            break;
          }
        } catch (e) { /* sonraki dosya */ }
      }
    }
    metaSet("legacy_checked", "1");
    persist();
  }

  function init() { open(); migrateLegacy(); }

  function snapshot() {
    const r = db.exec("SELECT k,v FROM entries");
    const data = {};
    if (r.length) {
      r[0].values.forEach((row) => {
        try { data[row[0]] = JSON.parse(row[1]); } catch (e) { data[row[0]] = row[1]; }
      });
    }
    const s = metaGet("savedAt");
    const savedAt = s ? Number(s) : 0;
    const has = Object.keys(data).length > 0;
    return {
      savedAt,
      text: has ? JSON.stringify({ app: "haftalik-plan", v: 2, savedAt, data }) : null
    };
  }

  function write(text) {
    const o = JSON.parse(String(text));
    if (!o || o.app !== "haftalik-plan" || !o.data || typeof o.data !== "object") throw new Error("Gecersiz veri");
    writeData(o.data, o.savedAt || Date.now());
  }

  return { init, snapshot, write };
}

module.exports = { createStore };
