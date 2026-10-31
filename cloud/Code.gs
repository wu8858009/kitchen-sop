/** @OnlyCurrentDoc */
/**
 * 廚房 SOP 食譜及倍數計算系統 — 雲端後端（Google Apps Script ＋ Google 試算表）
 *
 * 網頁版與 Windows 版用 POST { a: 動作, key: 存取密碼, ... } 呼叫這個「網頁應用程式」：
 *   ping / rev / load / save（save 帶 baseRev，版本不符時回 conflict，由前端合併後再送）
 * 資料以一般表格存放在「食譜」「食材」「步驟」「單價」工作表，可以直接在試算表裡查看或修改；
 * 手動修改後 onEdit 會更新版本號，各裝置下次同步時就會讀到。
 *
 * 部署：執行身分＝我、誰可以存取＝所有人。
 */

// ↓↓↓ 請改成你自己的存取密碼（至少 6 個字），網頁版／桌面版連線時輸入同一組 ↓↓↓
const ACCESS_KEY = "";

const APP = "kitchen-sop";
const CHUNK = 45000; // 每格上限 5 萬字，照片分段存放

const SHEETS = {
  recipes: { name: "食譜", cols: ["id", "名稱", "分類", "基準份量", "份量單位", "備註", "照片", "建立時間", "更新時間"], text: [1, 2, 3, 5, 6, 7] },
  ings: { name: "食材", cols: ["食譜id", "食譜名稱", "順序", "分組", "食材", "數量", "單位", "備註", "id"], text: [1, 2, 4, 5, 7, 8, 9] },
  steps: { name: "步驟", cols: ["食譜id", "食譜名稱", "順序", "步驟說明", "計時(分)", "重點", "id"], text: [1, 2, 4, 6, 7] },
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
    if (!ACCESS_KEY || String(ACCESS_KEY).length < 6) {
      return out_({ ok: false, error: "尚未設定存取密碼：請在 Apps Script 的 Code.gs 修改 ACCESS_KEY（至少 6 個字），儲存後重新部署新版本" });
    }
    if (String(req.key || "") !== String(ACCESS_KEY)) return out_({ ok: false, auth: true, error: "存取密碼錯誤" });
    const ss = SpreadsheetApp.getActive();
    switch (req.a) {
      case "ping": return out_({ ok: true, app: APP, rev: rev_(ss), recipes: Math.max(0, sheet_(ss, "recipes").getLastRow() - 1) });
      case "rev": return out_({ ok: true, rev: rev_(ss) });
      case "load": return out_(load_(ss));
      case "save": return out_(save_(ss, req));
    }
    return out_({ ok: false, error: "未知的動作：" + req.a });
  } catch (err) {
    return out_({ ok: false, error: "雲端發生錯誤：" + (err && err.message ? err.message : err) });
  }
}

function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

// ---------------------------------------------------------------- 工作表工具

function sheet_(ss, key) {
  const def = SHEETS[key];
  let sh = ss.getSheetByName(def.name);
  if (!sh) {
    sh = ss.insertSheet(def.name);
    sh.getRange(1, 1, 1, def.cols.length).setValues([def.cols]).setFontWeight("bold");
    sh.setFrozenRows(1);
    // 文字欄設成純文字，避免「1/2」被自動轉成日期
    def.text.forEach((c) => sh.getRange(1, c, 1000, 1).setNumberFormat("@"));
  }
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
    ingredients: [], steps: [],
  }));
  const byId = {};
  recipes.forEach((r) => { byId[r.id] = r; });

  const ings = rows_(ss, "ings").filter((r) => byId[str_(r[0])] && (r[4] !== "" || r[5] !== ""));
  ings.sort((a, b) => (num_(a[2]) || 0) - (num_(b[2]) || 0));
  ings.forEach((r) => byId[str_(r[0])].ingredients.push({ id: str_(r[8]), group: str_(r[3]), name: str_(r[4]), qty: num_(r[5]), unit: str_(r[6]), note: str_(r[7]) }));

  const steps = rows_(ss, "steps").filter((r) => byId[str_(r[0])] && r[3] !== "");
  steps.sort((a, b) => (num_(a[2]) || 0) - (num_(b[2]) || 0));
  steps.forEach((r) => byId[str_(r[0])].steps.push({ id: str_(r[6]), text: str_(r[3]), minutes: num_(r[4]), key: isTrue_(r[5]) }));

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
      recipeRows.push([str_(r.id), str_(r.name), str_(r.category), num_(r.yieldQty) || 1, str_(r.yieldUnit), str_(r.notes), str_(r.photoHash), date_(r.createdAt), date_(r.updatedAt)]);
      (r.ingredients || []).forEach((i, k) => ingRows.push([str_(r.id), str_(r.name), k + 1, str_(i.group), str_(i.name), i.qty == null ? "" : Number(i.qty), str_(i.unit), str_(i.note), str_(i.id)]));
      (r.steps || []).forEach((s, k) => stepRows.push([str_(r.id), str_(r.name), k + 1, str_(s.text), s.minutes == null ? "" : Number(s.minutes), s.key ? "是" : "", str_(s.id)]));
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
