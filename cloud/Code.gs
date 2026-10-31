/** @OnlyCurrentDoc */
/**
 * 廚房 SOP 食譜及倍數計算系統 — 雲端後端（Google Apps Script ＋ Google 試算表）
 *
 * 網頁版與 Windows 版用 POST { a: 動作, key: 存取密碼, ... } 呼叫這個「網頁應用程式」：
 *   ping / rev / load / save（save 帶 baseRev，版本不符時回 conflict，由前端合併後再送）
 *   translate（用 Google 翻譯把中文轉成越南文）
 * 資料以一般表格存放在「食譜」「食材」「步驟」「單價」工作表，可以直接在試算表裡查看或修改；
 * 手動修改後 onEdit 會更新版本號，各裝置下次同步時就會讀到。
 *
 * 部署：執行身分＝我、誰可以存取＝所有人。
 */

// 存取密碼：留空時，第一次從 App 按「連線」所輸入的密碼（至少 6 個字）會被記住成為存取密碼，
// 存在「專案設定 → 指令碼屬性 → ACCESS_KEY_V2」；要換密碼就刪掉該屬性（記得按儲存）再重新連線。
// 也可以直接在下面填寫（填了就以這裡為準）。
const ACCESS_KEY = "";
const KEY_PROP = "ACCESS_KEY_V2"; // 2026-10-31 重設：舊的 ACCESS_KEY 屬性不再使用

const APP = "kitchen-sop";
const CHUNK = 45000; // 每格上限 5 萬字，照片分段存放

const SHEETS = {
  recipes: { name: "食譜", cols: ["id", "名稱", "分類", "基準份量", "份量單位", "備註", "照片", "建立時間", "更新時間", "名稱(越)", "分類(越)", "備註(越)"], text: [1, 2, 3, 5, 6, 7, 10, 11, 12] },
  ings: { name: "食材", cols: ["食譜id", "食譜名稱", "順序", "分組", "食材", "數量", "單位", "備註", "id", "分組(越)", "食材(越)", "備註(越)"], text: [1, 2, 4, 5, 7, 8, 9, 10, 11, 12] },
  steps: { name: "步驟", cols: ["食譜id", "食譜名稱", "順序", "步驟說明", "計時(分)", "重點", "id", "步驟說明(越)"], text: [1, 2, 4, 6, 7, 8] },
  prices: { name: "單價", cols: ["id", "食材", "價格", "每", "單位"], text: [1, 2, 5] },
  photos: { name: "照片(系統)", cols: ["hash", "片段數"], text: [1] },
  sys: { name: "系統", cols: ["項目", "值"], text: [1, 2] },
};

// ---------------------------------------------------------------- 進入點

function doGet() {
  return out_({ ok: true, app: APP, message: "廚房 SOP 雲端後端運作中（請由 App 連線）" });
}

function doPost(e) {
  let req = {};
  try { req = JSON.parse((e && e.postData && e.postData.contents) || "{}"); } catch (x) {}
  try {
    let claimed = false;
    if (!accessKey_()) claimed = claimKey_(req);
    if (String(req.key || "") !== accessKey_()) return out_({ ok: false, auth: true, error: "存取密碼錯誤" });
    const ss = SpreadsheetApp.getActive();
    switch (req.a) {
      case "ping": return out_({ ok: true, app: APP, rev: rev_(ss), recipes: Math.max(0, sheet_(ss, "recipes").getLastRow() - 1), claimed: claimed });
      case "rev": return out_({ ok: true, rev: rev_(ss) });
      case "load": return out_(load_(ss));
      case "save": return out_(save_(ss, req));
      case "translate": return out_(translate_(req));
    }
    return out_({ ok: false, error: "未知的動作：" + req.a });
  } catch (err) {
    return out_({ ok: false, error: "雲端發生錯誤：" + (err && err.message ? err.message : err) });
  }
}

function accessKey_() {
  return String(ACCESS_KEY || PropertiesService.getScriptProperties().getProperty(KEY_PROP) || "");
}

/** 還沒有存取密碼時，第一次連線（ping）的密碼成為存取密碼 */
function claimKey_(req) {
  const k = String(req.key || "");
  if (req.a !== "ping" || k.length < 6) throw new Error("雲端尚未設定存取密碼：請在 App 輸入至少 6 個字的密碼後按「連線」");
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (accessKey_()) return false; // 同時有人先設定了
    PropertiesService.getScriptProperties().setProperty(KEY_PROP, k);
    return true;
  } finally {
    lock.releaseLock();
  }
}

/** 在 Apps Script 編輯器執行一次以完成授權，並建立各工作表 */
function setup() {
  const ss = SpreadsheetApp.getActive();
  Object.keys(SHEETS).forEach((k) => sheet_(ss, k));
  const first = ss.getSheets()[0];
  if (ss.getSheets().length > Object.keys(SHEETS).length && first.getLastRow() === 0) ss.deleteSheet(first);
  Logger.log("完成：工作表已建立，可以部署網頁應用程式了。");
}

function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

// ---------------------------------------------------------------- 工作表工具

const checked_ = {};
function sheet_(ss, key) {
  const def = SHEETS[key];
  let sh = ss.getSheetByName(def.name);
  if (!sh) {
    sh = ss.insertSheet(def.name);
    sh.getRange(1, 1, 1, def.cols.length).setValues([def.cols]).setFontWeight("bold");
    sh.setFrozenRows(1);
    // 文字欄設成純文字，避免「1/2」被自動轉成日期
    def.text.forEach((c) => sh.getRange(1, c, 1000, 1).setNumberFormat("@"));
  } else if (!checked_[key] && key !== "photos") {
    // 舊版工作表少了後來新增的欄位（例如越南文）：補上標題
    const head = sh.getRange(1, 1, 1, def.cols.length).getValues()[0];
    const miss = def.cols.some((c, i) => head[i] === "" || head[i] == null);
    if (miss) {
      sh.getRange(1, 1, 1, def.cols.length).setValues([def.cols]).setFontWeight("bold");
      def.text.forEach((c) => { if (head[c - 1] === "" || head[c - 1] == null) sh.getRange(1, c, Math.max(1000, sh.getMaxRows()), 1).setNumberFormat("@"); });
    }
  }
  checked_[key] = true;
  return sh;
}

function rows_(ss, key) {
  const sh = sheet_(ss, key);
  const n = sh.getLastRow() - 1;
  if (n <= 0) return [];
  const width = key === "photos" ? Math.max(2, sh.getLastColumn()) : SHEETS[key].cols.length;
  return sh.getRange(2, 1, n, width).getValues();
}

function writeRows_(ss, key, rows) {
  const sh = sheet_(ss, key);
  const width = SHEETS[key].cols.length;
  const old = sh.getLastRow() - 1;
  if (old > 0) sh.getRange(2, 1, old, width).clearContent();
  if (rows.length) {
    const def = SHEETS[key];
    if (rows.length + 1 > 1000) def.text.forEach((c) => sh.getRange(1, c, rows.length + 1, 1).setNumberFormat("@"));
    sh.getRange(2, 1, rows.length, width).setValues(rows);
  }
}

const str_ = (v) => (v == null ? "" : v instanceof Date ? v.toISOString() : String(v));
function num_(v) {
  if (v === "" || v == null) return null;
  if (v instanceof Date) return v.getTime();
  const n = Number(v);
  return isFinite(n) ? n : null;
}
const date_ = (ms) => (ms ? new Date(Number(ms)) : "");
const isTrue_ = (v) => v === true || /^(是|v|y|yes|true|1|✓|○)$/i.test(String(v).trim());

function sysGet_(ss) {
  const o = {};
  rows_(ss, "sys").forEach((r) => { if (r[0] !== "") o[String(r[0])] = r[1]; });
  return o;
}
function sysSet_(ss, o) {
  writeRows_(ss, "sys", Object.keys(o).map((k) => [k, typeof o[k] === "string" ? o[k] : JSON.stringify(o[k])]));
}
const rev_ = (ss) => Number(sysGet_(ss).rev) || 0;
function json_(s, dflt) { try { return s ? JSON.parse(s) : dflt; } catch (e) { return dflt; } }

// ---------------------------------------------------------------- 讀取

function load_(ss) {
  const sys = sysGet_(ss);
  const recipes = rows_(ss, "recipes").filter((r) => r[0] !== "").map((r) => ({
    id: str_(r[0]), name: str_(r[1]), category: str_(r[2]), yieldQty: num_(r[3]), yieldUnit: str_(r[4]),
    notes: str_(r[5]), photoHash: str_(r[6]), createdAt: num_(r[7]), updatedAt: num_(r[8]),
    nameVi: str_(r[9]), categoryVi: str_(r[10]), notesVi: str_(r[11]),
    ingredients: [], steps: [],
  }));
  const byId = {};
  recipes.forEach((r) => { byId[r.id] = r; });

  const ings = rows_(ss, "ings").filter((r) => byId[str_(r[0])] && (r[4] !== "" || r[5] !== ""));
  ings.sort((a, b) => (num_(a[2]) || 0) - (num_(b[2]) || 0));
  ings.forEach((r) => byId[str_(r[0])].ingredients.push({ id: str_(r[8]), group: str_(r[3]), name: str_(r[4]), qty: num_(r[5]), unit: str_(r[6]), note: str_(r[7]), groupVi: str_(r[9]), nameVi: str_(r[10]), noteVi: str_(r[11]) }));

  const steps = rows_(ss, "steps").filter((r) => byId[str_(r[0])] && r[3] !== "");
  steps.sort((a, b) => (num_(a[2]) || 0) - (num_(b[2]) || 0));
  steps.forEach((r) => byId[str_(r[0])].steps.push({ id: str_(r[6]), text: str_(r[3]), minutes: num_(r[4]), key: isTrue_(r[5]), textVi: str_(r[7]) }));

  const prices = rows_(ss, "prices").filter((r) => r[1] !== "").map((r) => ({ id: str_(r[0]), name: str_(r[1]), price: num_(r[2]), perQty: num_(r[3]) || 1, perUnit: str_(r[4]) }));

  const photos = {};
  rows_(ss, "photos").forEach((r) => { if (r[0] !== "") photos[str_(r[0])] = r.slice(2, 2 + (Number(r[1]) || 0)).join(""); });
  recipes.forEach((r) => { r.photo = photos[r.photoHash] || ""; delete r.photoHash; });

  return {
    ok: true, rev: Number(sys.rev) || 0, photoHashes: Object.keys(photos),
    db: {
      version: 1, recipes: recipes, prices: prices,
      plan: json_(sys.plan, []), settings: json_(sys.settings, {}), deleted: json_(sys.deleted, {}),
      pricesUpdatedAt: Number(sys.pricesUpdatedAt) || 0,
    },
  };
}

// ---------------------------------------------------------------- 寫入

function save_(ss, req) {
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const sys = sysGet_(ss);
    const rev = Number(sys.rev) || 0;
    if (!req.force && Number(req.baseRev) !== rev) return { ok: false, conflict: true, rev: rev };

    const d = req.db || {};
    const recipes = Array.isArray(d.recipes) ? d.recipes : [];
    const incoming = req.photos || {};

    // 照片：只上傳新的，以 hash 對應
    const phSheet = sheet_(ss, "photos");
    const phRows = rows_(ss, "photos");
    const have = {};
    phRows.forEach((r, i) => { if (r[0] !== "") have[str_(r[0])] = i + 2; });
    const used = {};
    const need = [];
    recipes.forEach((r) => {
      if (!r.photoHash) return;
      used[r.photoHash] = true;
      if (!have[r.photoHash] && !incoming[r.photoHash] && need.indexOf(r.photoHash) < 0) need.push(r.photoHash);
    });
    if (need.length) return { ok: false, needPhotos: need, rev: rev };

    const recipeRows = [], ingRows = [], stepRows = [];
    recipes.forEach((r) => {
      recipeRows.push([str_(r.id), str_(r.name), str_(r.category), num_(r.yieldQty) || 1, str_(r.yieldUnit), str_(r.notes), str_(r.photoHash), date_(r.createdAt), date_(r.updatedAt), str_(r.nameVi), str_(r.categoryVi), str_(r.notesVi)]);
      (r.ingredients || []).forEach((i, k) => ingRows.push([str_(r.id), str_(r.name), k + 1, str_(i.group), str_(i.name), i.qty == null ? "" : Number(i.qty), str_(i.unit), str_(i.note), str_(i.id), str_(i.groupVi), str_(i.nameVi), str_(i.noteVi)]));
      (r.steps || []).forEach((s, k) => stepRows.push([str_(r.id), str_(r.name), k + 1, str_(s.text), s.minutes == null ? "" : Number(s.minutes), s.key ? "是" : "", str_(s.id), str_(s.textVi)]));
    });
    const priceRows = (Array.isArray(d.prices) ? d.prices : []).map((p) => [str_(p.id), str_(p.name), p.price == null ? "" : Number(p.price), Number(p.perQty) || 1, str_(p.perUnit)]);

    writeRows_(ss, "recipes", recipeRows);
    writeRows_(ss, "ings", ingRows);
    writeRows_(ss, "steps", stepRows);
    writeRows_(ss, "prices", priceRows);

    Object.keys(incoming).forEach((h) => {
      if (!used[h] || have[h]) return;
      const data = String(incoming[h]);
      const parts = [];
      for (let i = 0; i < data.length; i += CHUNK) parts.push(data.slice(i, i + CHUNK));
      phSheet.appendRow([h, parts.length].concat(parts));
      have[h] = -1;
    });
    // 刪除沒有食譜在用的照片（由下往上刪才不會錯位）
    const stale = phRows.map((r, i) => (r[0] !== "" && !used[str_(r[0])] ? i + 2 : 0)).filter(Boolean).reverse();
    stale.forEach((row) => phSheet.deleteRow(row));

    // 墓碑只保留 90 天
    const deleted = d.deleted && typeof d.deleted === "object" ? d.deleted : {};
    const cutoff = Date.now() - 90 * 864e5;
    Object.keys(deleted).forEach((k) => { if (deleted[k] < cutoff) delete deleted[k]; });

    const next = rev + 1;
    sysSet_(ss, {
      rev: String(next), updatedAt: new Date().toISOString(),
      plan: d.plan || [], settings: d.settings || {}, deleted: deleted,
      pricesUpdatedAt: String(Number(d.pricesUpdatedAt) || 0),
    });
    return { ok: true, rev: next, photoHashes: Object.keys(used) };
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------- 翻譯

/** { texts: [中文…] } → { vi: [越南文…] }；一次最多 200 段 */
function translate_(req) {
  const texts = (Array.isArray(req.texts) ? req.texts : []).slice(0, 200);
  const vi = texts.map((t) => {
    const s = String(t == null ? "" : t).trim();
    if (!s) return "";
    try { return LanguageApp.translate(s, "zh-TW", "vi"); } catch (e) { return ""; }
  });
  return { ok: true, vi: vi };
}

// ---------------------------------------------------------------- 在試算表手動修改時

function onEdit(e) {
  try {
    const sh = e.range.getSheet();
    const name = sh.getName();
    const ss = sh.getParent();
    const key = Object.keys(SHEETS).filter((k) => SHEETS[k].name === name)[0];
    if (!key || key === "sys" || key === "photos") return;
    const sys = sysGet_(ss);
    if (key === "prices") sys.pricesUpdatedAt = String(Date.now());
    else {
      const r0 = Math.max(2, e.range.getRow());
      const n = e.range.getRow() + e.range.getNumRows() - r0;
      if (n > 0) {
        const ids = {};
        sh.getRange(r0, 1, n, 1).getValues().forEach((v) => { if (v[0] !== "") ids[String(v[0])] = true; });
        const rs = sheet_(ss, "recipes");
        const list = rows_(ss, "recipes");
        list.forEach((r, i) => { if (ids[String(r[0])]) rs.getRange(i + 2, 9, 1, 1).setValues([[new Date()]]); });
      }
    }
    sys.rev = String((Number(sys.rev) || 0) + 1);
    sysSet_(ss, sys);
  } catch (err) {
    // 手動編輯不應被打斷
  }
}
