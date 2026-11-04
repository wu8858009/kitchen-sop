/* 廚房 SOP 食譜及倍數計算系統 */
(() => {
  'use strict';
  const U = window.KUnits;
  const APP_VERSION = '2.7.5';
  const IS_DESKTOP = /[?&]desktop=1\b/.test(location.search);

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const escML = s => esc(s).replace(/\n/g, '<br>');
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const clone = o => JSON.parse(JSON.stringify(o));
  const normName = s => String(s || '').trim().toLowerCase().replace(/\s+/g, '');
  // 越南文只用在小抄卡片：中文下方加一行越南文（食譜內容用翻譯好的欄位，固定字用字典）
  const viOn = () => (db.settings.cheat || {}).vi !== false;
  const trVi = zh => (window.KVi ? window.KVi.tr(zh) : '');
  const bv = (zh, vi) => (viOn() && vi && String(vi).trim() ? `<span class="bi">${esc(zh)}<span class="vi" lang="vi">${esc(vi)}</span></span>` : esc(zh));
  const bvML = (zh, vi) => (viOn() && vi && String(vi).trim() ? `<span class="bi">${escML(zh)}<span class="vi" lang="vi">${escML(vi)}</span></span>` : escML(zh));
  const bt = zh => bv(zh, trVi(zh));
  const fmt = U.fmtNum;
  const money = n => (n == null || !isFinite(n) ? '—' : '$' + (Math.abs(n) >= 100 ? Math.round(n).toLocaleString() : n.toFixed(1)));
  const dateStr = () => { const d = new Date(); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`; };

  function num(v) {
    if (v === '' || v == null) return null;
    const n = typeof v === 'number' ? v : U.parseQty(String(v));
    return n == null || !isFinite(n) ? null : n;
  }

  // 倍數輸入：2、1.5、1/3、/3、÷3、除3、x2、×2、*2（可加「倍」）
  function parseMult(v) {
    if (typeof v === 'number') return v > 0 && isFinite(v) ? v : null;
    const s = String(v == null ? '' : v).trim().replace(/倍$/, '').trim();
    let m = s.match(/^(?:[÷\/／]|除以?)\s*(.+)$/);
    if (m) { const d = num(m[1]); return d > 0 ? 1 / d : null; }
    m = s.match(/^[x×*＊Ｘｘ]\s*(.+)$/i);
    const n = num(m ? m[1] : s);
    return n > 0 ? n : null;
  }
  // 小於 1 的倍數盡量顯示成分數（1/3、2/3、3/4）
  function multText(m) {
    if (m > 0 && m < 1) for (let d = 2; d <= 12; d++) { const n = Math.round(m * d); if (n && Math.abs(m * d - n) < 1e-6) return `${n}/${d}`; }
    return fmt(m);
  }

  // ---------------------------------------------------------------- 儲存
  const IDB = {
    _db: null,
    open() {
      if (this._db) return Promise.resolve(this._db);
      return new Promise((res, rej) => {
        const r = indexedDB.open('kitchen-sop', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => res((this._db = r.result));
        r.onerror = () => rej(r.error);
      });
    },
    async get(k) {
      const d = await this.open();
      return new Promise((res, rej) => { const q = d.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
    },
    async set(k, v) {
      const d = await this.open();
      return new Promise((res, rej) => { const tx = d.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, k); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
    },
  };

  let apiPromise = null;
  function desktopApi() {
    return (apiPromise = apiPromise || new Promise(res => {
      const ok = () => window.pywebview && window.pywebview.api && window.pywebview.api.load;
      if (ok()) return res(window.pywebview.api);
      window.addEventListener('pywebviewready', () => res(window.pywebview.api), { once: true });
      const iv = setInterval(() => { if (ok()) { clearInterval(iv); res(window.pywebview.api); } }, 100);
    }));
  }

  const Store = {
    async load() {
      if (IS_DESKTOP) { const s = await (await desktopApi()).load(); return s ? JSON.parse(s) : null; }
      try { const v = await IDB.get('db'); if (v) return v; } catch (e) { console.warn(e); }
      const s = localStorage.getItem('kitchen-sop-db');
      return s ? JSON.parse(s) : null;
    },
    async save(data) {
      if (IS_DESKTOP) {
        const ok = await (await desktopApi()).save(JSON.stringify(data));
        if (ok !== true) throw new Error(ok || '寫入檔案失敗');
        return;
      }
      try { await IDB.set('db', data); } catch (e) { localStorage.setItem('kitchen-sop-db', JSON.stringify(data)); }
    },
  };

  let db = null;
  let loadFailed = false;
  let saveTimer = null;
  let changeSeq = 0; // 每次本機修改 +1，用來判斷同步期間是否又有新修改
  /** 寫入本機（IndexedDB / 桌面版資料檔），不影響雲端狀態 */
  function saveLocal(now) {
    if (loadFailed) return;
    clearTimeout(saveTimer);
    const run = () => { saveTimer = null; Store.save(db).catch(e => toast('儲存失敗：' + e.message, 'err')); };
    if (now) run(); else saveTimer = setTimeout(run, 250);
  }
  /** 使用者修改了資料：存本機，並排程上傳到 Google */
  function persist(now) {
    if (loadFailed) return;
    db.pristine = false;
    if (db.cloud) { db.sync.dirty = true; changeSeq++; scheduleCloudSync(); }
    saveLocal(now);
  }
  const flush = () => { if (saveTimer) saveLocal(true); };
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
  window.addEventListener('pagehide', flush);

  // ---------------------------------------------------------------- 資料模型
  function emptyDb() {
    return { version: 1, recipes: [], prices: [], sops: [], inv: normInv(null), plan: [], settings: { unitMode: 'auto', ringTone: 'beep', ringVol: 0.8 }, deleted: {}, pricesUpdatedAt: 0, cloud: null, sync: { rev: 0, dirty: false, photos: [] } };
  }

  function normRecipe(r) {
    r = r || {};
    return {
      id: String(r.id || uid()),
      name: String(r.name || '未命名食譜'),
      category: String(r.category || ''),
      yieldQty: num(r.yieldQty) || 1,
      yieldUnit: String(r.yieldUnit || '份'),
      photo: typeof r.photo === 'string' ? r.photo : '',
      notes: String(r.notes || ''),
      nameVi: String(r.nameVi || ''), categoryVi: String(r.categoryVi || ''), notesVi: String(r.notesVi || ''),
      ingredients: (Array.isArray(r.ingredients) ? r.ingredients : []).map(i => ({
        id: String(i.id || uid()), group: String(i.group || ''), name: String(i.name || ''),
        qty: num(i.qty), unit: String(i.unit || ''), note: String(i.note || ''),
        groupVi: String(i.groupVi || ''), nameVi: String(i.nameVi || ''), noteVi: String(i.noteVi || ''),
      })),
      steps: (Array.isArray(r.steps) ? r.steps : []).map(s => ({
        id: String(s.id || uid()), text: String(s.text || ''), minutes: num(s.minutes), key: !!s.key, textVi: String(s.textVi || ''),
      })),
      createdAt: r.createdAt || Date.now(),
      updatedAt: r.updatedAt || Date.now(),
    };
  }

  // SOP 主資料（依紙本「單點 SOP」表單）
  const normSopRow = x => {
    x = x || {};
    const str = k => String(x[k] == null ? '' : x[k]);
    return { id: String(x.id || uid()), name: str('name'), qty: str('qty'), unit: str('unit') || '公克', vendor: str('vendor'),
      specQty: str('specQty'), specUnit: str('specUnit') || '公克', price: str('price'), loss: str('loss'), yieldText: str('yieldText') };
  };
  function normSop(o) {
    o = o || {};
    const rv = o.review || {};
    return {
      id: String(o.id || uid()), title: String(o.title || ''),
      review: { date: String(rv.date || ''), reviewer: String(rv.reviewer || ''), reviewee: String(rv.reviewee || ''), result: rv.result === 'pass' || rv.result === 'fail' ? rv.result : '', retake: String(rv.retake || '') },
      rows: (Array.isArray(o.rows) ? o.rows : []).map(normSopRow),
      steps: String(o.steps || ''), notes: String(o.notes || ''), photo: typeof o.photo === 'string' ? o.photo : '',
      net: o.net == null || o.net === '' ? '' : String(o.net), gross: o.gross == null || o.gross === '' ? '' : String(o.gross),
      yieldText: String(o.yieldText || ''),
      createdAt: o.createdAt || Date.now(), updatedAt: o.updatedAt || Date.now(),
    };
  }

  function normPrice(p) {
    return { id: String(p.id || uid()), name: String(p.name || ''), price: num(p.price), perQty: num(p.perQty) || 1, perUnit: String(p.perUnit || '') };
  }

  function normalizeDb(d) {
    const e = emptyDb();
    d = d && typeof d === 'object' ? d : {};
    return {
      version: 1,
      recipes: Array.isArray(d.recipes) ? d.recipes.map(normRecipe) : [],
      prices: Array.isArray(d.prices) ? d.prices.map(normPrice) : [],
      plan: Array.isArray(d.plan) ? d.plan.filter(x => x && x.recipeId).map(x => ({ recipeId: String(x.recipeId), mult: num(x.mult) || 1 })) : [],
      settings: Object.assign(e.settings, d.settings || {}),
      deleted: d.deleted && typeof d.deleted === 'object' && !Array.isArray(d.deleted) ? { ...d.deleted } : {},
      sops: Array.isArray(d.sops) ? d.sops.map(normSop) : [],
      inv: normInv(d.inv),
      pricesUpdatedAt: +d.pricesUpdatedAt || 0,
      pristine: !!d.pristine, // 只有自動放入、沒動過的範例資料
      cloud: d.cloud && d.cloud.url ? { url: String(d.cloud.url), key: String(d.cloud.key || '') } : null,
      sync: {
        rev: +(d.sync && d.sync.rev) || 0,
        dirty: !!(d.sync && d.sync.dirty),
        force: !!(d.sync && d.sync.force),
        photos: d.sync && Array.isArray(d.sync.photos) ? d.sync.photos : [],
        at: (d.sync && d.sync.at) || 0,
      },
    };
  }
  /** 匯出／上傳時不帶裝置專屬的雲端設定 */
  function shareable(d) {
    const { cloud, sync, pristine, ...rest } = d;
    return rest;
  }

  const getRecipe = id => db.recipes.find(r => r.id === id);
  const categories = () => [...new Set(db.recipes.map(r => r.category.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-Hant'));

  function sampleData() {
    const I = (name, qty, unit, note = '', group = '') => ({ name, qty, unit, note, group });
    const S = (text, minutes = null, key = false) => ({ text, minutes, key });
    return {
      recipes: [
        {
          name: '古早味滷肉（肉燥）', category: '主菜', yieldQty: 20, yieldUnit: '份',
          notes: '保存：冷藏 3 天、冷凍 1 個月。分裝時每份約 120 g。',
          ingredients: [
            I('豬五花絞肉', 2, 'kg', '粗絞'), I('蒜末', 50, 'g'), I('紅蔥頭酥', 150, 'g'),
            I('醬油', 300, 'ml', '', '滷汁'), I('米酒', 100, 'ml', '', '滷汁'), I('冰糖', 80, 'g', '', '滷汁'),
            I('五香粉', 4, 'g', '約 2 小匙', '滷汁'), I('白胡椒粉', 2, 'g', '約 1 小匙', '滷汁'), I('水', 1.5, 'L', '', '滷汁'),
          ],
          steps: [
            S('熱鍋不放油，下絞肉以中火煸炒至出油、表面微焦。', 10),
            S('加入蒜末炒香，再加入紅蔥頭酥拌勻。', 2),
            S('沿鍋邊嗆入醬油、米酒，炒出醬香。', 2),
            S('加入冰糖、五香粉、白胡椒粉與水，大火煮滾後轉小火。'),
            S('加蓋小火燉煮，每 15 分鐘攪拌一次避免黏鍋。', 60, true),
            S('起鍋前試味。若要冷藏，須在 2 小時內降溫至 7°C 以下。', null, true),
          ],
        },
        {
          name: '三杯雞', category: '主菜', yieldQty: 4, yieldUnit: '份',
          ingredients: [
            I('去骨雞腿肉', 600, 'g', '切塊'), I('黑麻油', 3, '大匙'), I('老薑片', 60, 'g'), I('蒜頭', 15, '顆'),
            I('醬油', 3, '大匙', '', '醬汁'), I('米酒', 3, '大匙', '', '醬汁'), I('冰糖', 15, 'g', '約 1 大匙', '醬汁'),
            I('九層塔', 1, '把'), I('辣椒', 1, '條', '斜切'),
          ],
          steps: [
            S('黑麻油小火煸老薑片至捲曲微乾。', 5, true),
            S('放入蒜頭煸至金黃，再放入雞肉煎至表面上色。', 5),
            S('加入醬油、米酒、冰糖，加蓋中小火燜煮。', 8),
            S('開蓋大火收汁，起鍋前放入九層塔、辣椒拌勻。', 2),
          ],
        },
        {
          name: '番茄蛋花湯', category: '湯品', yieldQty: 6, yieldUnit: '碗',
          ingredients: [
            I('牛番茄', 3, '顆', '切塊'), I('雞蛋', 3, '顆', '打散'), I('高湯', 1.5, 'L'), I('鹽', 5, 'g', '約 1 小匙'),
            I('白胡椒粉', null, '', '適量'), I('蔥花', 20, 'g'), I('太白粉水', 2, '大匙'),
          ],
          steps: [
            S('番茄下鍋略炒出汁，加入高湯煮滾。', 3),
            S('轉小火煮至番茄軟化。', 8),
            S('以鹽調味，加入太白粉水勾薄芡。'),
            S('關火後以畫圈方式倒入蛋液，靜置 10 秒再攪拌，撒上蔥花與白胡椒粉。', null, true),
          ],
        },
      ].map(normRecipe).map(fillSampleVi),
      prices: [
        ['豬五花絞肉', 130, 1, '台斤'], ['蒜末', 160, 1, 'kg'], ['紅蔥頭酥', 350, 1, 'kg'], ['醬油', 120, 1, 'L'],
        ['米酒', 50, 600, 'ml'], ['冰糖', 80, 1, 'kg'], ['五香粉', 60, 100, 'g'], ['白胡椒粉', 90, 100, 'g'],
        ['水', 0, 1, 'L'], ['去骨雞腿肉', 260, 1, 'kg'], ['黑麻油', 220, 500, 'ml'], ['老薑片', 120, 1, 'kg'],
        ['蒜頭', 2, 1, '顆'], ['九層塔', 15, 1, '把'], ['辣椒', 3, 1, '條'], ['牛番茄', 15, 1, '顆'],
        ['雞蛋', 6, 1, '顆'], ['高湯', 40, 1, 'L'], ['鹽', 25, 1, 'kg'], ['蔥花', 100, 1, 'kg'], ['太白粉水', 10, 500, 'ml'],
      ].map(([name, price, perQty, perUnit]) => normPrice({ name, price, perQty, perUnit })),
    };
  }

  // 範例食譜的越南文
  const SAMPLE_VI = {
    '古早味滷肉（肉燥）': 'Thịt kho kiểu xưa (thịt băm kho)', '三杯雞': 'Gà ba chén', '番茄蛋花湯': 'Canh cà chua trứng', '主菜': 'Món chính', '湯品': 'Món canh',
    '保存：冷藏 3 天、冷凍 1 個月。分裝時每份約 120 g。': 'Bảo quản: ngăn mát 3 ngày, ngăn đông 1 tháng. Khi chia phần, mỗi phần khoảng 120 g.',
    '豬五花絞肉': 'Thịt ba chỉ xay', '蒜末': 'Tỏi băm', '紅蔥頭酥': 'Hành phi', '醬油': 'Nước tương', '米酒': 'Rượu gạo', '冰糖': 'Đường phèn',
    '五香粉': 'Ngũ vị hương', '白胡椒粉': 'Tiêu trắng xay', '水': 'Nước', '去骨雞腿肉': 'Đùi gà rút xương', '黑麻油': 'Dầu mè đen', '老薑片': 'Gừng già thái lát',
    '蒜頭': 'Tỏi', '九層塔': 'Húng quế', '辣椒': 'Ớt', '牛番茄': 'Cà chua', '雞蛋': 'Trứng gà', '高湯': 'Nước dùng', '鹽': 'Muối', '蔥花': 'Hành lá thái nhỏ',
    '太白粉水': 'Nước bột năng', '粗絞': 'Xay thô', '切塊': 'Cắt miếng', '斜切': 'Cắt xéo', '打散': 'Đánh tan', '適量': 'Vừa đủ',
    '約 2 小匙': 'Khoảng 2 muỗng cà phê', '約 1 小匙': 'Khoảng 1 muỗng cà phê', '約 1 大匙': 'Khoảng 1 muỗng canh', '滷汁': 'Nước kho', '醬汁': 'Nước sốt',
    '熱鍋不放油，下絞肉以中火煸炒至出油、表面微焦。': 'Làm nóng chảo không cho dầu, cho thịt xay vào xào lửa vừa đến khi ra mỡ và mặt hơi xém.',
    '加入蒜末炒香，再加入紅蔥頭酥拌勻。': 'Cho tỏi băm vào phi thơm, rồi cho hành phi vào trộn đều.',
    '沿鍋邊嗆入醬油、米酒，炒出醬香。': 'Rưới nước tương và rượu gạo dọc thành chảo, xào đến khi dậy mùi thơm.',
    '加入冰糖、五香粉、白胡椒粉與水，大火煮滾後轉小火。': 'Cho đường phèn, ngũ vị hương, tiêu trắng và nước vào, đun lửa lớn đến sôi rồi hạ lửa nhỏ.',
    '加蓋小火燉煮，每 15 分鐘攪拌一次避免黏鍋。': 'Đậy nắp hầm lửa nhỏ, cứ 15 phút khuấy một lần để không bị dính nồi.',
    '起鍋前試味。若要冷藏，須在 2 小時內降溫至 7°C 以下。': 'Nếm lại trước khi tắt bếp. Nếu bảo quản lạnh, phải làm nguội xuống dưới 7°C trong vòng 2 giờ.',
    '黑麻油小火煸老薑片至捲曲微乾。': 'Phi gừng già thái lát với dầu mè đen ở lửa nhỏ đến khi cong lại và hơi khô.',
    '放入蒜頭煸至金黃，再放入雞肉煎至表面上色。': 'Cho tỏi vào phi đến vàng, rồi cho thịt gà vào áp chảo đến khi mặt ngoài vàng.',
    '加入醬油、米酒、冰糖，加蓋中小火燜煮。': 'Cho nước tương, rượu gạo, đường phèn vào, đậy nắp om lửa vừa nhỏ.',
    '開蓋大火收汁，起鍋前放入九層塔、辣椒拌勻。': 'Mở nắp đun lửa lớn cho cạn sốt, trước khi tắt bếp cho húng quế và ớt vào đảo đều.',
    '番茄下鍋略炒出汁，加入高湯煮滾。': 'Xào sơ cà chua cho ra nước, cho nước dùng vào đun sôi.',
    '轉小火煮至番茄軟化。': 'Hạ lửa nhỏ nấu đến khi cà chua mềm.',
    '以鹽調味，加入太白粉水勾薄芡。': 'Nêm muối, cho nước bột năng vào tạo độ sánh nhẹ.',
    '關火後以畫圈方式倒入蛋液，靜置 10 秒再攪拌，撒上蔥花與白胡椒粉。': 'Tắt bếp rồi đổ trứng vào theo vòng tròn, để yên 10 giây rồi mới khuấy, rắc hành lá và tiêu trắng.',
  };
  function fillSampleVi(r) {
    const f = (o, k, kv) => { if (o[k] && !o[kv] && SAMPLE_VI[o[k]]) o[kv] = SAMPLE_VI[o[k]]; };
    f(r, 'name', 'nameVi'); f(r, 'category', 'categoryVi'); f(r, 'notes', 'notesVi');
    r.ingredients.forEach(i => { f(i, 'name', 'nameVi'); f(i, 'note', 'noteVi'); f(i, 'group', 'groupVi'); });
    r.steps.forEach(x => f(x, 'text', 'textVi'));
    return r;
  }

  // ---------------------------------------------------------------- 成本
  function priceMap() {
    const m = new Map();
    for (const p of db.prices) if (p.name.trim() && p.price != null && p.perQty) m.set(normName(p.name), p);
    return m;
  }
  function costOf(pm, name, qty, unit) {
    if (qty == null) return { state: 'none' };
    const p = pm.get(normName(name));
    if (!p) return { state: 'missing' };
    const q = U.convert(qty, unit, p.perUnit);
    if (q == null) return { state: 'unit', p };
    return { state: 'ok', cost: q / p.perQty * p.price };
  }
  // 只填名稱（數量、單位、備註都空白）的食材列當成小標題，例如「出餐」
  const isHead = i => !!String(i.name || '').trim() && (i.qty == null || String(i.qty).trim() === '') && !String(i.unit || '').trim() && !String(i.note || '').trim();
  const ingCount = r => r.ingredients.filter(i => !isHead(i)).length;

  function recipeCost(r, mult, pm) {
    pm = pm || priceMap();
    let total = 0, missing = 0;
    for (const i of r.ingredients) {
      if (!i.name.trim() || isHead(i)) continue;
      const c = costOf(pm, i.name, i.qty == null ? null : i.qty * mult, i.unit);
      if (c.state === 'ok') total += c.cost;
      else if (c.state !== 'none') missing++;
    }
    return { total, missing, perUnit: total / (r.yieldQty * mult) };
  }
  const costCell = c => c.state === 'ok' ? money(c.cost)
    : c.state === 'missing' ? '<span class="muted" title="單價表沒有這個食材">無單價</span>'
    : c.state === 'unit' ? `<span class="warn" title="單價表單位為「${esc(c.p.perUnit)}」，無法換算">單位不符</span>` : '';

  // ---------------------------------------------------------------- UI 小工具
  function toast(msg, kind) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'show ' + (kind || '');
    clearTimeout(toast._h);
    toast._h = setTimeout(() => { t.className = ''; }, kind === 'err' ? 5000 : 2200);
  }

  function modal({ title, body, buttons }) {
    return new Promise(res => {
      const m = $('#modal');
      m.innerHTML = `<div class="modal-back"><div class="modal" role="dialog" aria-modal="true">
        <h3>${esc(title)}</h3><div class="modal-body">${body || ''}</div>
        <div class="modal-btns">${buttons.map((b, i) => `<button class="btn ${b.cls || ''}" data-mb="${i}">${esc(b.label)}</button>`).join('')}</div></div></div>`;
      m.classList.add('open');
      const close = v => { m.classList.remove('open'); m.innerHTML = ''; m.onclick = m.onkeydown = null; res(v); };
      const pick = i => { const b = buttons[i]; const v = b.value === undefined ? true : b.value; close(typeof v === 'function' ? v(m) : v); };
      m.onclick = e => {
        const b = e.target.closest('[data-mb]');
        if (b) pick(+b.dataset.mb);
        else if (e.target.classList.contains('modal-back')) close(null);
      };
      m.onkeydown = e => {
        if (e.key === 'Escape') { e.preventDefault(); close(null); }
        // 輸入法選字時按的 Enter 不算「確定」
        else if (e.key === 'Enter' && e.target.tagName === 'INPUT' && !e.isComposing && e.keyCode !== 229) { const i = buttons.findIndex(b => /primary|danger/.test(b.cls || '')); if (i >= 0) { e.preventDefault(); pick(i); } }
      };
      const f = m.querySelector('input,textarea');
      setTimeout(() => (f || m.querySelector('.btn.primary') || m.querySelector('.btn')).focus(), 30);
    });
  }
  const confirmBox = (title, body, okLabel = '確定', danger = false) =>
    modal({ title, body: `<p>${body}</p>`, buttons: [{ label: '取消', value: false }, { label: okLabel, cls: danger ? 'danger' : 'primary', value: true }] });

  const UNIT_MODES = [['auto', '自動（g↔kg、ml↔L）'], ['original', '保留原單位'], ['metric', '全部換成公制'], ['tw', '台制（台斤／兩）']];
  const unitModeSelect = id => `<select id="${id}" data-act-change="unitmode">${UNIT_MODES.map(([v, l]) => `<option value="${v}" ${db.settings.unitMode === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  const COMMON_UNITS = ['g', 'kg', '台斤', '兩', 'ml', 'L', '大匙', '小匙', '杯', '顆', '個', '片', '條', '根', '把', '包', '罐', '瓶', '盒', '隻', '尾', '瓣', '粒', '張'];

  function fmtDur(sec) {
    sec = Math.max(0, Math.ceil(sec));
    const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
    const p = n => String(n).padStart(2, '0');
    return h ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`;
  }

  // ---------------------------------------------------------------- 路由
  let route = { name: 'list', id: null };
  let draft = null; // 編輯中的食譜
  let lastHash = location.hash;

  function parseRoute() {
    const h = location.hash.replace(/^#\/?/, '');
    const [a, b] = h.split('/');
    return { name: a || 'list', id: b ? decodeURIComponent(b) : null };
  }
  const isEditHash = h => /^#\/(edit|new)\b/.test(h);

  function onHash() {
    if (draft && draft.dirty && !isEditHash(location.hash)) {
      if (!window.confirm('食譜有尚未儲存的變更，確定要離開嗎？')) { history.replaceState(null, '', lastHash); return; }
    }
    if (!isEditHash(location.hash)) draft = null;
    lastHash = location.hash;
    render();
    window.scrollTo(0, 0);
  }

  function render() {
    route = parseRoute();
    const app = $('#app');
    $$('.tabs a').forEach(a => a.classList.toggle('on', a.dataset.tab === ({ r: 'list', edit: 'list', new: 'list', sop: 'sops' }[route.name] || route.name)));
    switch (route.name) {
      case 'r': app.innerHTML = viewRecipe(route.id); updateRecipeComputed(); break;
      case 'edit': case 'new': app.innerHTML = viewEdit(route.name === 'new' ? null : route.id); break;
      case 'plan': app.innerHTML = viewPlan(); updatePlanTotal(); break;
      case 'cheat': app.innerHTML = viewCheat(); updateCheat(); break;
      case 'sops': app.innerHTML = viewSops(); updateSopList(); break;
      case 'sop': app.innerHTML = viewSop(route.id); updateSopCalc(); break;
      case 'inv': app.innerHTML = viewInv(); fitInv(); break;
      case 'prices': app.innerHTML = viewPrices(); break;
      case 'labels': app.innerHTML = viewLabels(); updateLabel(); break;
      case 'settings': app.innerHTML = viewSettings(); fillSettingsInfo(); setSync(cloudState.s, cloudState.msg); break;
      default: app.innerHTML = viewList(); updateList();
    }
    const sopNow = route.name === 'sop' && getSop(route.id);
    document.title = (route.name === 'r' && getRecipe(route.id) ? getRecipe(route.id).name + ' - ' : sopNow ? (sopNow.title || 'SOP') + ' - ' : '') + '廚房 SOP 食譜';
  }
  const notFound = () => `<div class="page"><div class="empty"><p>找不到這個食譜，可能已被刪除。</p><a class="btn primary" href="#/">回食譜列表</a></div></div>`;

  // ---------------------------------------------------------------- 食譜列表
  let listFilter = { q: '', cat: '' };
  function viewList() {
    const cats = categories();
    if (listFilter.cat && !cats.includes(listFilter.cat)) listFilter.cat = '';
    return `<div class="page">
      ${loadFailed ? '<div class="banner err">讀取資料檔失敗，為避免覆蓋原本資料，目前不會儲存任何變更。請關閉程式並檢查資料檔。</div>' : ''}
      <div class="page-head">
        <input id="q" class="search" type="search" placeholder="搜尋食譜或食材…" value="${esc(listFilter.q)}" autocomplete="off">
        <a class="btn primary" href="#/new">＋ 新增食譜</a>
      </div>
      <div class="chips" id="cats">
        <button class="chip ${listFilter.cat ? '' : 'on'}" data-act="cat" data-v="">全部</button>
        ${cats.map(c => `<button class="chip ${listFilter.cat === c ? 'on' : ''}" data-act="cat" data-v="${esc(c)}">${esc(c)}</button>`).join('')}
      </div>
      <div class="grid" id="list"></div>
    </div>`;
  }
  function updateList() {
    const q = normName(listFilter.q);
    const pm = priceMap();
    const rs = db.recipes
      .filter(r => !listFilter.cat || r.category.trim() === listFilter.cat)
      .filter(r => !q || [r.name, r.category, r.nameVi, r.categoryVi].some(x => normName(x).includes(q)) || r.ingredients.some(i => normName(i.name).includes(q) || normName(i.nameVi).includes(q)))
      .sort((a, b) => a.category.localeCompare(b.category, 'zh-Hant') || a.name.localeCompare(b.name, 'zh-Hant'));
    const el = $('#list');
    if (!db.recipes.length) { el.innerHTML = `<div class="empty"><p>還沒有任何食譜。</p><a class="btn primary" href="#/new">＋ 新增第一個食譜</a> <button class="btn" data-act="seed">載入範例食譜</button></div>`; return; }
    if (!rs.length) { el.innerHTML = '<div class="empty"><p>沒有符合的食譜。</p></div>'; return; }
    el.innerHTML = rs.map(r => {
      const c = recipeCost(r, 1, pm);
      const mins = r.steps.reduce((t, s) => t + (s.minutes || 0), 0);
      return `<a class="rcard" href="#/r/${encodeURIComponent(r.id)}">
        <div class="thumb">${r.photo ? `<img src="${r.photo}" alt="">` : '<span>🍲</span>'}</div>
        <div class="rcard-body">
          ${r.category ? `<div class="cat">${esc(r.category)}</div>` : ''}
          <div class="rname">${esc(r.name)}</div>
          <div class="muted small">${fmt(r.yieldQty)} ${esc(r.yieldUnit)} · ${ingCount(r)} 食材 · ${r.steps.length} 步驟${mins ? ` · 約 ${fmt(mins)} 分` : ''}</div>
          ${c.total > 0 ? `<div class="small cost-line">每${esc(r.yieldUnit)} ${money(c.perUnit)}${c.missing ? `<span class="muted">（${c.missing} 項無單價）</span>` : ''}</div>` : ''}
        </div></a>`;
    }).join('');
  }

  // ---------------------------------------------------------------- 食譜檢視（倍數計算）
  const viewState = {};
  const vs = id => viewState[id] || (viewState[id] = { mult: 1, checked: new Set(), stepsDone: new Set() });
  const MULT_CHIPS = [[1 / 4, '÷4'], [1 / 3, '÷3'], [1 / 2, '÷2'], [1, '×1'], [1.5, '×1.5'], [2, '×2'], [3, '×3'], [4, '×4'], [5, '×5'], [10, '×10']];

  function viewRecipe(id) {
    const r = getRecipe(id);
    if (!r) return notFound();
    const mins = r.steps.reduce((t, s) => t + (s.minutes || 0), 0);
    const st = vs(id);
    return `<div class="page recipe-page">
      <div class="page-head no-print">
        <a class="btn ghost" href="#/">← 食譜</a>
        <div class="spacer"></div>
        ${!IS_DESKTOP && 'wakeLock' in navigator ? `<button class="btn ${wakeLock ? 'on' : ''}" data-act="wake" title="烹調時保持螢幕不關閉">💡 恆亮</button>` : ''}
        <button class="btn" data-act="print">🖨 列印</button>
        <button class="btn" data-act="addplan" data-id="${esc(r.id)}">＋ 備料單</button>
        <button class="btn" data-act="cheat-from-recipe" data-id="${esc(r.id)}">📝 小抄</button>
        <button class="btn" data-act="dup" data-id="${esc(r.id)}">複製</button>
        <a class="btn primary" href="#/edit/${encodeURIComponent(r.id)}">編輯</a>
      </div>
      <div class="hero">
        ${r.photo ? `<img class="hero-img" src="${r.photo}" alt="">` : ''}
        <div>
          ${r.category ? `<div class="cat">${esc(r.category)}</div>` : ''}
          <h1>${esc(r.name)}</h1>
          <div class="muted">基準份量 ${fmt(r.yieldQty)} ${esc(r.yieldUnit)} · ${ingCount(r)} 項食材 · ${r.steps.length} 個步驟${mins ? ` · 計時合計約 ${fmt(mins)} 分鐘` : ''}</div>
        </div>
      </div>

      <section class="card scale-card no-print">
        <div class="scale-row">
          <label class="fld">倍數<input id="mult" type="text" autocomplete="off" placeholder="2 或 /3" value="${multText(st.mult)}"></label>
          <span class="muted">或</span>
          <label class="fld">目標份量<span class="inline"><input id="target" type="number" inputmode="decimal" step="any" min="0" value="${fmt(r.yieldQty * st.mult)}"><span>${esc(r.yieldUnit)}</span></span></label>
          <label class="fld">單位顯示${unitModeSelect('unitMode')}</label>
        </div>
        <div class="chips" id="multChips">${MULT_CHIPS.map(([m, t]) => `<button class="chip" data-act="mult" data-v="${m}">${t}</button>`).join('')}</div>
        <p class="hint">倍數可輸入 2、1.5，或用「/3」「÷3」「1/3」表示除以幾倍。也可以點食材旁的 ⚖，輸入手邊現有的量，自動反推倍數。</p>
      </section>
      <div class="print-only print-scale" id="printScale"></div>

      <section class="card rc-ing">
        <div class="sec-head"><h2>食材</h2><span class="muted small" id="ingSub"></span>
          <div class="spacer"></div><button class="btn sm no-print" data-act="uncheck">清除勾選</button></div>
        <div id="ing"></div>
        <div id="costBox" class="cost-box"></div>
      </section>

      <section class="card rc-steps">
        <div class="sec-head"><h2>SOP 步驟</h2></div>
        ${r.steps.length ? `<ol class="steps">${r.steps.map((s, k) => `
          <li class="${s.key ? 'key' : ''} ${st.stepsDone.has(s.id) ? 'done' : ''}" data-act="stepdone" data-s="${esc(s.id)}">
            <div class="step-n">${k + 1}</div>
            <div class="step-body">
              <div class="step-text">${escML(s.text)}</div>
              <div class="step-meta">${s.key ? '<span class="badge red">重點</span>' : ''}
              ${s.minutes ? `<button class="btn sm timer-btn" data-act="timer" data-s="${esc(s.id)}">⏱ 計時 ${fmtDur(s.minutes * 60)}</button>` : ''}</div>
            </div></li>`).join('')}</ol>` : '<p class="muted">尚未建立步驟。</p>'}
      </section>
      ${r.notes.trim() ? `<section class="card"><h2>備註</h2><p>${escML(r.notes)}</p></section>` : ''}
    </div>`;
  }

  function updateRecipeComputed() {
    const r = getRecipe(route.id);
    if (!r || !$('#ing')) return;
    const st = vs(r.id), mult = st.mult, mode = db.settings.unitMode, pm = priceMap();
    const mi = $('#mult'), ti = $('#target');
    if (mi && document.activeElement !== mi) mi.value = multText(mult);
    if (ti && document.activeElement !== ti) ti.value = fmt(r.yieldQty * mult);
    $$('#multChips .chip').forEach(c => c.classList.toggle('on', Math.abs(+c.dataset.v - mult) < 1e-6));
    $('#ingSub').textContent = mult === 1 ? '（基準份量）' : `（× ${multText(mult)}，${fmt(r.yieldQty * mult)} ${r.yieldUnit}）`;
    $('#printScale').textContent = `倍數 × ${multText(mult)}　份量 ${fmt(r.yieldQty * mult)} ${r.yieldUnit}　列印時間 ${new Date().toLocaleString()}`;

    let html = '<table class="ing-table"><tbody>', lastGroup = null;
    for (const i of r.ingredients) {
      if (i.group.trim() !== (lastGroup || '') && (i.group.trim() || lastGroup) && !(isHead(i) && !i.group.trim())) { // 小標題本身就是分段，不再加「其他」
        html += `<tr class="grp"><td colspan="6">${esc(i.group.trim() || '其他')}</td></tr>`;
      }
      lastGroup = i.group.trim();
      if (isHead(i)) { html += `<tr class="grp sub"><td colspan="6">${esc(i.name)}</td></tr>`; continue; }
      const q = i.qty == null ? null : i.qty * mult;
      const d = U.display(q, i.unit, mode);
      const c = costOf(pm, i.name, q, i.unit);
      const on = st.checked.has(i.id);
      html += `<tr class="${on ? 'done' : ''}">
        <td class="ck"><input type="checkbox" data-act="check" data-i="${esc(i.id)}" ${on ? 'checked' : ''} aria-label="已備好"></td>
        <td class="nm">${esc(i.name)}${i.note ? `<div class="note">${esc(i.note)}</div>` : ''}</td>
        <td class="amt"><b>${esc(d.text)}</b>${d.alt ? `<div class="alt">${esc(d.alt)}</div>` : ''}</td>
        <td class="base">${mult !== 1 && i.qty != null ? `原 ${esc(fmt(i.qty) + ' ' + i.unit)}` : ''}</td>
        <td class="cost">${costCell(c)}</td>
        <td class="act no-print">${i.qty ? `<button class="icon" data-act="anchor" data-i="${esc(i.id)}" title="以這個食材現有的量換算倍數">⚖</button>` : ''}</td>
      </tr>`;
    }
    html += '</tbody></table>';
    $('#ing').innerHTML = r.ingredients.length ? html : '<p class="muted">尚未建立食材。</p>';

    const c = recipeCost(r, mult, pm);
    $('#costBox').innerHTML = c.total > 0 || c.missing ? `
      <div><span class="muted">食材成本</span><b>${money(c.total)}</b></div>
      <div><span class="muted">每${esc(r.yieldUnit)}</span><b>${money(c.perUnit)}</b></div>
      ${c.missing ? `<div class="warn small">有 ${c.missing} 項食材沒有單價或單位不符，未計入成本。<a href="#/prices" class="no-print">到單價表設定</a></div>` : ''}` : '';
  }

  function setMult(m) {
    if (!(m > 0) || !isFinite(m)) return;
    vs(route.id).mult = Math.round(m * 1e8) / 1e8;
    updateRecipeComputed();
  }

  async function anchorIngredient(iid) {
    const r = getRecipe(route.id), i = r && r.ingredients.find(x => x.id === iid);
    if (!i || !i.qty) return;
    const cur = i.qty * vs(r.id).mult;
    const v = await modal({
      title: `以「${i.name}」換算`,
      body: `<p>食譜基準用量：${esc(fmt(i.qty) + ' ' + i.unit)}。請輸入手邊現有（或要使用）的量：</p>
        <input class="big" id="anchorVal" value="${esc(fmt(cur) + (i.unit ? ' ' + i.unit : ''))}" placeholder="例如 3 kg、5 台斤、12">
        <p class="hint">可輸入不同單位（如 kg、台斤），只填數字則視為「${esc(i.unit || '同單位')}」。</p>`,
      buttons: [{ label: '取消', value: null }, { label: '換算', cls: 'primary', value: m => m.querySelector('#anchorVal').value }],
    });
    if (v == null) return;
    const a = U.parseAmount(v);
    if (!a) return toast('看不懂這個數量', 'err');
    const q = U.convert(a.qty, a.unit || i.unit, i.unit);
    if (q == null) return toast(`「${a.unit}」無法換算成「${i.unit}」`, 'err');
    setMult(q / i.qty);
    toast(`倍數已設為 × ${multText(vs(r.id).mult)}`);
  }

  // ---------------------------------------------------------------- 計時器
  const timers = [];
  let tickH = null, ringH = null, audioCtx = null;

  function ensureAudio() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch (e) { /* 無音效 */ }
  }
  // ---- 鈴聲：內建的用 Web Audio 合成（不需要音檔）；也可以上傳自己的音檔（只存在這台裝置）
  // period = 響鈴期間每隔幾秒重播一次
  const RING_TONES = {
    beep: { name: '嗶嗶聲', period: 1.8, play: n => { for (let k = 0; k < 3; k++) n(880, k * 0.25, 0.18, 'square', 0.25); } },
    dingdong: { name: '叮咚', period: 2.2, play: n => { n(784, 0, 0.9, 'sine', 0.5); n(659, 0.45, 1.2, 'sine', 0.5); } },
    bell: { name: '老式計時器鈴', period: 1.6, play: n => { for (let k = 0; k < 14; k++) n(k % 2 ? 1500 : 1250, k * 0.07, 0.06, 'triangle', 0.35); } },
    chime: { name: '柔和鐘聲', period: 2.6, play: n => { [523, 659, 784, 1047].forEach((f, k) => n(f, k * 0.18, 1.6, 'sine', 0.3)); } },
    alarm: { name: '急促警報', period: 1.2, play: n => { for (let k = 0; k < 4; k++) n(1000, k * 0.14, 0.1, 'sawtooth', 0.22, 1600); } },
    marimba: { name: '木琴', period: 2, play: n => { [1047, 1319, 1568, 2093].forEach((f, k) => { n(f, k * 0.13, 0.35, 'sine', 0.45); n(f * 4, k * 0.13, 0.08, 'sine', 0.08); }); } },
  };
  const RING_FILE_KEY = 'ksop.ringFile';
  let ringBuf = null, ringBufSrc = '', ringSrc = null;
  const ringFile = () => { try { return JSON.parse(localStorage.getItem(RING_FILE_KEY) || 'null'); } catch (e) { return null; } };
  const ringVol = () => Math.max(0, Math.min(1, db.settings.ringVol == null ? 0.8 : +db.settings.ringVol));

  async function customBuffer() {
    const f = ringFile();
    if (!f || !audioCtx) return null;
    if (ringBuf && ringBufSrc === f.data) return ringBuf;
    const bin = atob(f.data.split(',')[1]), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    ringBuf = await new Promise((res, rej) => audioCtx.decodeAudioData(bytes.buffer, res, rej));
    ringBufSrc = f.data;
    return ringBuf;
  }
  /** 播放一次鈴聲；custom 會一直重複，直到 stopRing() */
  async function playRing(tone, maxSec) {
    if (!audioCtx) return;
    const vol = ringVol(), t0 = audioCtx.currentTime + 0.02;
    if (tone === 'custom') {
      try {
        const buf = await customBuffer();
        if (buf) {
          stopRing();
          const src = audioCtx.createBufferSource(), g = audioCtx.createGain();
          src.buffer = buf; src.loop = !maxSec; g.gain.value = vol;
          src.connect(g).connect(audioCtx.destination);
          src.start(t0);
          if (maxSec) src.stop(t0 + Math.min(maxSec, buf.duration));
          ringSrc = src;
          return;
        }
      } catch (e) { /* 音檔無法播放：改用預設 */ }
      tone = 'beep';
    }
    const def = RING_TONES[tone] || RING_TONES.beep;
    // n(頻率, 開始, 長度, 波形, 音量, 滑到的頻率)
    def.play((f, at, dur, type, peak, f2) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = type; o.frequency.setValueAtTime(f, t0 + at);
      if (f2) o.frequency.linearRampToValueAtTime(f2, t0 + at + dur);
      g.gain.setValueAtTime(0.0001, t0 + at);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * vol), t0 + at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
      o.connect(g).connect(audioCtx.destination);
      o.start(t0 + at); o.stop(t0 + at + dur + 0.02);
    });
  }
  function stopRing() { if (ringSrc) { try { ringSrc.stop(); } catch (e) { /* 已停止 */ } ringSrc = null; } }
  function currentTone() { const t = db.settings.ringTone || 'beep'; return t === 'custom' && !ringFile() ? 'beep' : t; }
  function startRinging() {
    const tone = currentTone();
    playRing(tone);
    if (tone !== 'custom') ringH = setInterval(() => playRing(tone), (RING_TONES[tone] || RING_TONES.beep).period * 1000);
    else ringH = -1; // 音檔自己循環
  }
  function stopRinging() { if (ringH > 0) clearInterval(ringH); ringH = null; stopRing(); }
  const remaining = t => (t.paused != null ? t.paused : Math.max(0, (t.end - Date.now()) / 1000));

  function startTimer(label, seconds) {
    ensureAudio();
    timers.push({ id: uid(), label, end: Date.now() + seconds * 1000, paused: null, done: false });
    if (!IS_DESKTOP && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
    renderTimers();
    if (!tickH) tickH = setInterval(tick, 250);
    toast(`已開始計時 ${fmtDur(seconds)}`);
  }
  function tick() {
    let changed = false;
    for (const t of timers) {
      if (!t.done && t.paused == null && remaining(t) <= 0) {
        t.done = true; t.doneAt = Date.now(); changed = true;
        if ('vibrate' in navigator) navigator.vibrate([400, 150, 400, 150, 400]);
        if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
          try { new Notification('時間到！', { body: t.label, icon: 'icons/icon-192.png' }); } catch (e) { /* ignore */ }
        }
      }
    }
    if (changed) renderTimers();
    else $$('#timers .t-time').forEach(el => { const t = timers.find(x => x.id === el.dataset.t); if (t && !t.done) el.textContent = fmtDur(remaining(t)); });
    const ringing = timers.filter(t => t.done && Date.now() - t.doneAt < 120000);
    if (ringing.length && !ringH) startRinging();
    if (!ringing.length && ringH) stopRinging();
    if (!timers.length) { clearInterval(tickH); tickH = null; }
  }
  function renderTimers() {
    const el = $('#timers');
    el.innerHTML = timers.map(t => `<div class="timer ${t.done ? 'done' : ''} ${t.paused != null ? 'paused' : ''}">
      <div class="t-label" title="${esc(t.label)}">${esc(t.label)}</div>
      <div class="t-time" data-t="${t.id}">${t.done ? '時間到！' : fmtDur(remaining(t))}</div>
      <div class="t-btns">${t.done
        ? `<button class="btn sm primary" data-act="t-x" data-t="${t.id}">關閉</button>`
        : `<button class="icon" data-act="t-pause" data-t="${t.id}" title="${t.paused != null ? '繼續' : '暫停'}">${t.paused != null ? '▶' : '⏸'}</button>
           <button class="icon" data-act="t-add" data-t="${t.id}" title="加 1 分鐘">+1</button>
           <button class="icon" data-act="t-x" data-t="${t.id}" title="取消">✕</button>`}</div></div>`).join('');
    document.body.classList.toggle('has-timers', timers.length > 0);
  }
  function timerAction(act, id) {
    const k = timers.findIndex(t => t.id === id);
    if (k < 0) return;
    const t = timers[k];
    if (act === 't-x') timers.splice(k, 1);
    else if (act === 't-pause') {
      if (t.paused != null) { t.end = Date.now() + t.paused * 1000; t.paused = null; } else t.paused = remaining(t);
    } else if (act === 't-add') {
      if (t.paused != null) t.paused += 60; else t.end += 60000;
    }
    renderTimers();
    tick();
  }

  let wakeLock = null;
  async function toggleWake(btn) {
    try {
      if (wakeLock) { await wakeLock.release(); wakeLock = null; }
      else { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { if (!wakeLock || wakeLock.released) { wakeLock = null; $('[data-act="wake"]') && $('[data-act="wake"]').classList.remove('on'); } }); }
      btn.classList.toggle('on', !!wakeLock);
      toast(wakeLock ? '螢幕將保持恆亮' : '已取消螢幕恆亮');
    } catch (e) { toast('此裝置不支援螢幕恆亮', 'err'); }
  }

  // ---------------------------------------------------------------- 編輯食譜
  function toDraft(r) {
    const d = clone(r);
    d.yieldQty = fmt(d.yieldQty);
    d.ingredients.forEach(i => { i.qty = i.qty == null ? '' : fmt(i.qty); });
    d.steps.forEach(s => { s.minutes = s.minutes == null ? '' : fmt(s.minutes); });
    return d;
  }
  const blankIng = (group = '') => ({ id: uid(), group, name: '', qty: '', unit: '', note: '', groupVi: '', nameVi: '', noteVi: '' });
  const blankStep = () => ({ id: uid(), text: '', minutes: '', key: false, textVi: '' });

  function viewEdit(id) {
    const key = id || 'new';
    if (!draft || draft.key !== key) {
      const r = id ? getRecipe(id) : null;
      if (id && !r) return notFound();
      draft = { key, isNew: !r, dirty: false, viTouched: new Set(), r: r ? toDraft(r) : { ...toDraft(normRecipe({ name: ' ' })), name: '', ingredients: [blankIng(), blankIng(), blankIng()], steps: [blankStep(), blankStep()] } };
    }
    const r = draft.r, V = true;
    const viIn = (path, val, ph = '越南文') => (V ? `<input class="vi-in" data-bind="${path}" value="${esc(val || '')}" placeholder="${ph}" lang="vi" autocomplete="off">` : '');
    const names = [...new Set([...db.prices.map(p => p.name), ...db.recipes.flatMap(x => x.ingredients.map(i => i.name))].map(s => s.trim()).filter(Boolean))];
    const btns = (list, k, n) => `<div class="row-btns">
      <button class="icon" data-act="mv" data-list="${list}" data-k="${k}" data-d="-1" ${k === 0 ? 'disabled' : ''} title="上移">↑</button>
      <button class="icon" data-act="mv" data-list="${list}" data-k="${k}" data-d="1" ${k === n - 1 ? 'disabled' : ''} title="下移">↓</button>
      <button class="icon danger" data-act="rm" data-list="${list}" data-k="${k}" title="刪除">✕</button></div>`;
    return `<div class="page">
      <div class="page-head sticky-head">
        <button class="btn ghost" data-act="cancel-edit">取消</button>
        <h1 class="head-title">${draft.isNew ? '新增食譜' : '編輯食譜'}</h1>
        <div class="spacer"></div>
        ${V ? '<button class="btn" data-act="tr-draft">🌐 翻譯越南文</button>' : ''}
        <button class="btn primary" data-act="save-recipe">儲存</button>
      </div>
      <section class="card form-grid">
        <label class="fld wide">食譜名稱 *<input data-bind="name" value="${esc(r.name)}" placeholder="例如：古早味滷肉" autocomplete="off">${viIn('nameVi', r.nameVi)}</label>
        <label class="fld">分類<input data-bind="category" value="${esc(r.category)}" list="dl-cat" placeholder="主菜、湯品、醬料…">${viIn('categoryVi', r.categoryVi)}</label>
        <label class="fld">基準份量<input data-bind="yieldQty" value="${esc(r.yieldQty)}" inputmode="decimal"></label>
        <label class="fld">份量單位<input data-bind="yieldUnit" value="${esc(r.yieldUnit)}" list="dl-yu" placeholder="份、人份、碗、kg…"></label>
        <div class="fld wide photo-fld">
          <span>照片</span>
          <div class="photo-row">
            ${r.photo ? `<img src="${r.photo}" alt="">` : '<div class="photo-ph">🍲</div>'}
            <label class="btn">選擇照片<input type="file" accept="image/*" data-act-change="photo" hidden></label>
            ${r.photo ? '<button class="btn ghost" data-act="photo-rm">移除</button>' : ''}
          </div>
        </div>
      </section>

      <section class="card">
        <div class="sec-head"><h2>食材</h2><div class="spacer"></div><button class="btn sm" data-act="bulk" data-list="ingredients">批次貼上</button></div>
        <div class="ed-head ing"><span>分組</span><span>食材名稱</span><span>數量</span><span>單位</span><span>備註</span><span></span></div>
        <div class="ed-list">${r.ingredients.map((i, k) => `<div class="ed-row ing${i._head || isHead(i) ? ' is-head' : ''}">
          <input class="g" data-bind="ingredients.${k}.group" value="${esc(i.group)}" placeholder="分組" list="dl-grp">
          <input class="n" data-bind="ingredients.${k}.name" value="${esc(i.name)}" placeholder="${i._head ? '小標題（例如：出餐）' : '食材名稱'}" list="dl-names">
          <input class="q" data-bind="ingredients.${k}.qty" value="${esc(i.qty)}" placeholder="數量" inputmode="decimal">
          <input class="u" data-bind="ingredients.${k}.unit" value="${esc(i.unit)}" placeholder="單位" list="dl-units">
          <input class="nt" data-bind="ingredients.${k}.note" value="${esc(i.note)}" placeholder="備註（切丁、適量…）">
          ${btns('ingredients', k, r.ingredients.length)}
          ${V ? `<div class="vi-row">${viIn(`ingredients.${k}.groupVi`, i.groupVi, '分組（越南文）').replace('class="vi-in"', 'class="vi-in g"')}${viIn(`ingredients.${k}.nameVi`, i.nameVi, '食材名稱（越南文）').replace('class="vi-in"', 'class="vi-in n"')}${viIn(`ingredients.${k}.noteVi`, i.noteVi, '備註（越南文）').replace('class="vi-in"', 'class="vi-in nt"')}</div>` : ''}</div>`).join('')}</div>
        <div class="btn-row"><button class="btn" data-act="add" data-list="ingredients">＋ 新增食材</button><button class="btn" data-act="add-head">＋ 小標題</button></div>
        <p class="hint">數量可填 1.5、1/2、1 1/2；留空代表「適量」，不參與倍數計算。分組可區分「醃料」「醬汁」等。只填名稱、數量／單位／備註都空白的列會當成小標題（例如「出餐」），不計成本。</p>
      </section>

      <section class="card">
        <div class="sec-head"><h2>SOP 步驟</h2><div class="spacer"></div><button class="btn sm" data-act="bulk" data-list="steps">批次貼上</button></div>
        <div class="ed-list">${r.steps.map((s, k) => `<div class="ed-row step">
          <div class="step-n">${k + 1}</div>
          <textarea data-bind="steps.${k}.text" rows="2" placeholder="步驟說明">${esc(s.text)}</textarea>
          <label class="mini">計時(分)<input data-bind="steps.${k}.minutes" value="${esc(s.minutes)}" inputmode="decimal" placeholder="—"></label>
          <label class="mini chk"><input type="checkbox" data-bind="steps.${k}.key" ${s.key ? 'checked' : ''}>重點</label>
          ${btns('steps', k, r.steps.length)}
          ${V ? `<textarea class="vi-in vi-step" data-bind="steps.${k}.textVi" rows="2" placeholder="步驟說明（越南文）" lang="vi">${esc(s.textVi || '')}</textarea>` : ''}</div>`).join('')}</div>
        <button class="btn" data-act="add" data-list="steps">＋ 新增步驟</button>
        <p class="hint">有填「計時」的步驟會出現計時按鈕；「重點」會以紅色標示（例如溫度、衛生、關鍵火候）。</p>
      </section>

      <section class="card">
        <h2>備註</h2>
        <textarea data-bind="notes" rows="3" placeholder="保存方式、出餐注意事項…">${esc(r.notes)}</textarea>
        ${V ? `<textarea class="vi-in" data-bind="notesVi" rows="3" placeholder="備註（越南文）" lang="vi">${esc(r.notesVi || '')}</textarea>
        <p class="hint">虛線框是越南文（只顯示在小抄卡片上）。留空會在儲存時用 Google 翻譯自動填入（需連線 Google 雲端），也可以自己修改。</p>` : ''}
      </section>
      ${draft.isNew ? '' : '<div class="danger-zone"><button class="btn danger" data-act="delete-recipe">刪除此食譜</button></div>'}

      <datalist id="dl-units">${COMMON_UNITS.map(u => `<option value="${u}">`).join('')}</datalist>
      <datalist id="dl-names">${names.map(n => `<option value="${esc(n)}">`).join('')}</datalist>
      <datalist id="dl-cat">${categories().map(c => `<option value="${esc(c)}">`).join('')}</datalist>
      <datalist id="dl-yu">${['份', '人份', '碗', '盤', '盒', '個', 'kg', 'L', '鍋'].map(u => `<option value="${u}">`).join('')}</datalist>
      <datalist id="dl-grp">${[...new Set(r.ingredients.map(i => i.group.trim()).filter(Boolean))].map(g => `<option value="${esc(g)}">`).join('')}</datalist>
    </div>`;
  }

  function rerenderEdit(focusSel) {
    const y = window.scrollY;
    $('#app').innerHTML = viewEdit(draft.isNew ? null : draft.key);
    window.scrollTo(0, y);
    if (focusSel) { const f = $(focusSel); if (f) f.focus(); }
  }

  function setPath(obj, path, val) {
    const p = path.split('.');
    let o = obj;
    for (let k = 0; k < p.length - 1; k++) o = o[p[k]];
    o[p[p.length - 1]] = val;
  }

  function parseIngLine(line) {
    line = line.replace(/^[\s\-*•・‧·\d.、)）]+(?=\D)/, '').trim();
    if (!line) return null;
    const m = line.match(/^(.+?)[\s:：]*(\d+\s+\d+\/\d+|\d+(?:\.\d+)?\s*\/\s*\d+|\d*\.?\d+[½¼¾]?|[½¼¾])\s*([^\s\d(（]*)\s*(.*)$/);
    if (m && m[1].trim()) return { ...blankIng(), name: m[1].trim(), qty: m[2].replace(/\s+/g, ' '), unit: m[3], note: m[4].replace(/^[(（]|[)）]$/g, '').trim() };
    const parts = line.split(/\s+/);
    return { ...blankIng(), name: parts[0], note: parts.slice(1).join(' ') };
  }
  function parseStepLine(line) {
    line = line.replace(/^\s*(\d+[.、)）]|[-*•])\s*/, '').trim();
    if (!line) return null;
    const m = line.match(/(\d+(?:\.\d+)?)\s*(分鐘|分|min)/);
    return { ...blankStep(), text: line, minutes: m ? m[1] : '' };
  }

  async function bulkPaste(list) {
    const isIng = list === 'ingredients';
    const text = await modal({
      title: isIng ? '批次貼上食材' : '批次貼上步驟',
      body: `<p class="hint">${isIng ? '每行一項，格式：「名稱 數量 單位 備註」，例如：<br>豬五花絞肉 2 kg 粗絞<br>醬油 300ml<br>白胡椒粉 適量' : '每行一個步驟；行內含「10 分鐘」會自動帶入計時。'}</p>
        <textarea id="bulkText" rows="9"></textarea>`,
      buttons: [{ label: '取消', value: null }, { label: '加入', cls: 'primary', value: m => m.querySelector('#bulkText').value }],
    });
    if (!text) return;
    const items = text.split(/\r?\n/).map(isIng ? parseIngLine : parseStepLine).filter(Boolean);
    if (!items.length) return;
    const arr = draft.r[list];
    const isBlank = x => isIng ? !x.name.trim() && !String(x.qty).trim() : !x.text.trim();
    while (arr.length && isBlank(arr[arr.length - 1])) arr.pop();
    arr.push(...items);
    draft.dirty = true;
    rerenderEdit();
    toast(`已加入 ${items.length} 項`);
  }

  function resizeImage(file, max = 800) {
    return new Promise((res, rej) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const s = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        res(c.toDataURL('image/jpeg', 0.75));
      };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('無法讀取圖片')); };
      img.src = url;
    });
  }

  function saveDraft() {
    const r = draft.r;
    $$('.invalid').forEach(el => el.classList.remove('invalid'));
    const bad = sel => { const el = $(sel); if (el) { el.classList.add('invalid'); el.focus(); } };
    if (!r.name.trim()) { bad('[data-bind="name"]'); return toast('請填寫食譜名稱', 'err'); }
    if (!(num(r.yieldQty) > 0)) { bad('[data-bind="yieldQty"]'); return toast('基準份量必須是大於 0 的數字', 'err'); }
    for (let k = 0; k < r.ingredients.length; k++) {
      const i = r.ingredients[k];
      if (String(i.qty).trim() && num(i.qty) == null) { bad(`[data-bind="ingredients.${k}.qty"]`); return toast(`第 ${k + 1} 項食材的數量「${i.qty}」無法辨識`, 'err'); }
      if (!i.name.trim() && String(i.qty).trim()) { bad(`[data-bind="ingredients.${k}.name"]`); return toast(`第 ${k + 1} 項食材缺少名稱`, 'err'); }
    }
    for (let k = 0; k < r.steps.length; k++) {
      const s = r.steps[k];
      if (String(s.minutes).trim() && !(num(s.minutes) >= 0)) { bad(`[data-bind="steps.${k}.minutes"]`); return toast(`第 ${k + 1} 步的計時無法辨識`, 'err'); }
    }
    const rec = normRecipe({
      ...r,
      name: r.name.trim(), category: r.category.trim(), yieldUnit: r.yieldUnit.trim() || '份',
      ingredients: r.ingredients.filter(i => i.name.trim()).map(i => ({ ...i, name: i.name.trim(), unit: i.unit.trim(), group: i.group.trim(), note: i.note.trim() })),
      steps: r.steps.filter(s => s.text.trim()).map(s => ({ ...s, text: s.text.trim(), minutes: num(s.minutes) || null })),
      updatedAt: Date.now(),
    });
    const k = db.recipes.findIndex(x => x.id === rec.id);
    if (k >= 0) db.recipes[k] = rec; else db.recipes.push(rec);
    persist(true);
    draft = null;
    toast('已儲存');
    setTimeout(autoTranslate, 300);
    location.hash = '#/r/' + encodeURIComponent(rec.id);
  }

  // ---------------------------------------------------------------- 備料單
  function viewPlan() {
    db.plan = db.plan.filter(p => getRecipe(p.recipeId));
    const avail = [...db.recipes].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
    return `<div class="page">
      <div class="page-head"><h1 class="head-title">備料單</h1><div class="spacer"></div>
        ${db.plan.length ? '<button class="btn" data-act="cheat-from-plan">📝 做成小抄</button><button class="btn" data-act="print">🖨 列印</button><button class="btn ghost no-print" data-act="plan-clear">清空</button>' : ''}</div>
      <p class="muted no-print">把今天要做的菜加進來並設定倍數，系統會自動合併相同食材的總用量與成本，方便叫貨與備料。</p>
      <section class="card">
        <h2>菜色與倍數</h2>
        <div class="plan-items">${db.plan.map((p, k) => { const r = getRecipe(p.recipeId); return `<div class="plan-item">
          <a class="pname" href="#/r/${encodeURIComponent(r.id)}">${esc(r.name)}</a>
          <label class="inline">×<input type="text" autocomplete="off" placeholder="2 或 /3" data-plan="${k}" value="${multText(p.mult)}"></label>
          <span class="muted small" id="py${k}">${fmt(r.yieldQty * p.mult)} ${esc(r.yieldUnit)}</span>
          <button class="icon danger no-print" data-act="plan-rm" data-k="${k}" title="移除">✕</button></div>`; }).join('') || '<p class="muted">尚未加入菜色。</p>'}</div>
        ${avail.length ? `<div class="plan-add no-print"><select id="planAdd">${avail.map(r => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('')}</select>
          <button class="btn primary" data-act="plan-add">＋ 加入</button></div>` : ''}
      </section>
      <section class="card">
        <div class="sec-head"><h2>合計食材</h2><div class="spacer"></div><label class="fld inline-fld no-print">單位 ${unitModeSelect('unitMode2')}</label></div>
        <div id="planTotal"></div>
      </section>
    </div>`;
  }

  function updatePlanTotal() {
    const el = $('#planTotal');
    if (!el) return;
    if (!db.plan.length) { el.innerHTML = '<p class="muted">加入菜色後會顯示合計。</p>'; return; }
    const pm = priceMap(), mode = db.settings.unitMode;
    const map = new Map();
    for (const p of db.plan) {
      const r = getRecipe(p.recipeId);
      for (const i of r.ingredients) {
        const k = normName(i.name);
        if (!k || isHead(i)) continue;
        let e = map.get(k);
        if (!e) map.set(k, (e = { name: i.name.trim(), parts: [], from: new Set(), loose: false }));
        e.from.add(r.name);
        if (i.qty == null) e.loose = true;
        else e.parts.push({ qty: i.qty * p.mult, unit: i.unit });
      }
    }
    let total = 0, missing = 0;
    const rows = [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant')).map(e => {
      let cost = 0, miss = false;
      for (const part of e.parts) { const c = costOf(pm, e.name, part.qty, part.unit); if (c.state === 'ok') cost += c.cost; else miss = true; }
      total += cost; if (miss) missing++;
      const amts = U.sum(e.parts).map(s => { const d = U.display(s.qty, s.unit, mode); return `<b>${esc(d.text)}</b>${d.alt ? ` <span class="alt">(${esc(d.alt)})</span>` : ''}`; });
      if (e.loose) amts.push('<span class="muted">＋適量</span>');
      return `<tr><td class="ck"><input type="checkbox" aria-label="已備好" data-act="plan-check"></td><td class="nm">${esc(e.name)}<div class="note">${esc([...e.from].join('、'))}</div></td>
        <td class="amt">${amts.join('<br>')}</td><td class="cost">${e.parts.length ? (miss ? (cost ? money(cost) + ' <span class="warn">*</span>' : '<span class="muted">無單價</span>') : money(cost)) : ''}</td></tr>`;
    });
    el.innerHTML = `<table class="ing-table plan-table"><tbody>${rows.join('')}</tbody></table>
      <div class="cost-box"><div><span class="muted">食材總成本</span><b>${money(total)}</b></div>
      ${missing ? `<div class="warn small">* 有 ${missing} 項食材缺少單價或單位不符，未完整計入。</div>` : ''}</div>`;
  }

  // ---------------------------------------------------------------- 標籤（精臣 B3S）
  // 版面寬×高存在 settings.labels 跟著同步；品名、日期只留在這次操作，隔天不會印到舊日期
  const LABEL_DEF = { w: 50, h: 30, days: '', who: '', copies: 1, density: 3, paper: 1, task: '', a4fill: true, saved: [] };
  const LABEL_SIZES = [[30, 20], [40, 30], [50, 30], [50, 40], [60, 40], [70, 50], [72, 50]];
  const LABEL_DOTS = 8;                       // 203 dpi ≒ 每公釐 8 點
  const LABEL_MAX_W = 72;                     // B3S 列印頭 576 點 = 72 公釐
  const LABEL_SITE = 'https://wu8858009.github.io/kitchen-sop/';
  const NIIM_LIB = 'vendor/niimbluelib.min.js?v=37';
  const labelForm = { name: '', qty: '', note: '', made: null, exp: '' };   // made：null = 今天，'' = 不印
  let niim = null;                            // 已連線的印表機
  let labelQ = '';                            // 已儲存標籤的搜尋字
  const canUsb = () => !IS_DESKTOP && !!navigator.serial, canBt = () => !IS_DESKTOP && !!navigator.bluetooth;
  function labelCfg() {
    const c = Object.assign({}, LABEL_DEF, db.settings.labels || {});
    return (db.settings.labels = c);
  }
  const labelMade = () => (labelForm.made == null ? ymd(new Date()) : labelForm.made);
  function labelExp() {
    const d = parseFloat(labelCfg().days), m = labelMade() || ymd(new Date()); // 製造日期不印時從今天算
    if (!(d >= 0)) return labelForm.exp;
    const x = new Date(m + 'T00:00:00');
    x.setDate(x.getDate() + Math.round(d));
    return ymd(x);
  }
  const labelDate = s => String(s || '').replace(/-/g, '/');

  /** 畫在 canvas：1 點 = 印表機 1 點，純黑白，所以預覽就是印出來的樣子 */
  function drawLabel(cv, dots = LABEL_DOTS) {
    const c = labelCfg(), f = labelForm, W = Math.round(c.w) * dots, H = Math.round(c.h) * dots;
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d'), pad = 2 * dots, FONT = '"Microsoft JhengHei", "PingFang TC", "Noto Sans TC", sans-serif';
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#000'; g.textBaseline = 'top';
    const rows = [];
    if (f.name.trim()) rows.push({ t: f.name.trim(), k: 1.7 });
    if (f.qty.trim()) rows.push({ t: '份量 ' + f.qty.trim(), k: 1 });
    if (labelMade()) rows.push({ t: '製造 ' + labelDate(labelMade()), k: 1 });
    if (labelExp()) rows.push({ t: '到期 ' + labelDate(labelExp()), k: 1.2 });
    if (String(c.who).trim()) rows.push({ t: '人員 ' + String(c.who).trim(), k: 1 });
    if (f.note.trim()) rows.push({ t: f.note.trim(), k: 1 });
    if (!rows.length) return cv;
    // 字從大往小試，直到全部排得下
    const maxW = W - pad * 2, maxH = H - pad * 2;
    let size = Math.floor(maxH / 1.2);
    const fit = s => {
      let h = 0;
      for (const r of rows) {
        g.font = `bold ${Math.round(s * r.k)}px ${FONT}`;
        if (g.measureText(r.t).width > maxW) return false;
        h += s * r.k * 1.2;
      }
      return h <= maxH;
    };
    while (size > 10 && !fit(size)) size--;
    const total = rows.reduce((n, r) => n + size * r.k * 1.2, 0);
    let y = Math.max(pad, (H - total) / 2);
    for (const r of rows) {
      g.font = `bold ${Math.round(size * r.k)}px ${FONT}`;
      g.fillText(r.t, pad, Math.round(y), maxW);
      y += size * r.k * 1.2;
    }
    if (dots !== LABEL_DOTS) return cv;     // A4 用一般印表機，解析度高，不必二值化
    // 熱感紙只有黑白，灰階的字邊直接二值化
    const im = g.getImageData(0, 0, W, H), px = im.data;
    for (let i = 0; i < px.length; i += 4) { const v = px[i] < 160 ? 0 : 255; px[i] = px[i + 1] = px[i + 2] = v; px[i + 3] = 255; }
    g.putImageData(im, 0, 0);
    return cv;
  }
  function updateLabel() {
    const cv = $('#labelCv');
    if (!cv) return;
    drawLabel(cv);
    const c = labelCfg(), ex = $('#labelExp');
    cv.style.aspectRatio = `${c.w} / ${c.h}`;
    cv.style.width = `min(100%, ${c.w * 6}px)`;
    if (ex && document.activeElement !== ex) ex.value = labelExp();
    const a4 = $('#labelA4');
    if (a4) { const g = a4Grid(); a4.textContent = `A4 一頁可排 ${g.cols} × ${g.rows} = ${g.cols * g.rows} 張`; }
  }
  function labelStatus() {
    if (niim) return `<span class="badge">🟢 已連線：${esc((niim.getModelMetadata() || {}).model || '印表機')}</span>`;
    if (IS_DESKTOP) return '<span class="muted small">電腦版視窗不能直接連印表機，按右上角按鈕會把這張標籤帶到瀏覽器，用 USB 或藍牙列印（要用 Edge 或 Chrome）。</span>';
    if (!canUsb() && !canBt()) return '<span class="muted small">這個瀏覽器不能直接連印表機（iPhone／iPad 都不行）。請按「存成圖片」，再到精臣 App 匯入圖片列印。</span>';
    return `<span class="muted small">先打開 B3S 電源，${canUsb() ? '接上 USB 線按「USB 連線」，或' : ''}按「藍牙連線」，再從清單選擇印表機。舊款 B3S 的藍牙可能連不上，請改用 USB。</span>`;
  }
  // 已儲存的標籤：同品名算同一張，再存一次就更新；日期不存，載入時用當天重算
  function labelSavedHtml() {
    const q = normName(labelQ), rows = labelCfg().saved.filter(x => !q || normName(x.name).includes(q));
    if (!rows.length) return `<p class="muted small">${labelCfg().saved.length ? '找不到符合的標籤。' : '還沒有儲存的標籤。填好內容後按「儲存這張標籤」，下次點一下就能帶入。'}</p>`;
    return rows.map(x => `<div class="label-item">
      <button class="label-load" data-act="label-load" data-id="${esc(x.id)}"><b>${esc(x.name)}</b>
        <span class="muted small">${esc(x.w)}×${esc(x.h)}${x.qty ? ' · ' + esc(x.qty) : ''}${x.days !== '' ? ` · 保存 ${esc(x.days)} 天` : ''}</span></button>
      <button class="icon danger" data-act="label-rm" data-id="${esc(x.id)}" title="刪除" aria-label="刪除 ${esc(x.name)}">✕</button></div>`).join('');
  }
  async function labelSave() {
    const c = labelCfg(), f = labelForm, name = f.name.trim();
    if (!name) { toast('請先填品名', 'err'); const n = $('[data-label="name"]'); if (n) n.focus(); return; }
    const old = c.saved.find(x => normName(x.name) === normName(name));
    const rec = { id: old ? old.id : uid(), name, qty: f.qty.trim(), note: f.note.trim(), who: String(c.who).trim(), days: String(c.days).trim(), noMade: f.made === '', w: c.w, h: c.h, copies: c.copies, at: Date.now() };
    c.saved = [rec, ...c.saved.filter(x => x !== old)];
    persist(); labelQ = ''; render();
    toast(old ? `已更新「${name}」` : `已儲存「${name}」`);
  }
  function labelLoad(id) {
    const c = labelCfg(), x = c.saved.find(y => y.id === id);
    if (!x) return;
    Object.assign(labelForm, { name: x.name, qty: x.qty, note: x.note, made: x.noMade ? '' : null, exp: '' });
    Object.assign(c, { who: x.who, days: x.days, w: x.w, h: x.h, copies: x.copies });
    persist(); render();
    toast(`已帶入「${x.name}」`);
  }
  function viewLabels() {
    const c = labelCfg(), f = labelForm;
    // 從電腦版帶過來的標籤內容
    if (route.id) {
      try {
        const j = JSON.parse(route.id);
        Object.assign(c, j.cfg || {}); Object.assign(f, j.form || {}); persist();
      } catch (e) { /* 內容壞掉就當作沒帶 */ }
      history.replaceState(null, '', '#/labels');
      route = { name: 'labels', id: null };
    }
    const names = [...new Set([...db.recipes.map(r => r.name), ...db.sops.map(o => o.title), ...db.inv.items.map(x => x.name)].map(x => String(x || '').trim()).filter(Boolean))];
    const sized = LABEL_SIZES.some(([w, h]) => w === c.w && h === c.h);
    const inp = (k, label, val, attr = '') => `<label class="fld">${label}<input data-label="${k}" value="${esc(val)}" autocomplete="off" ${attr}></label>`;
    return `<div class="page label-page">
      <div class="page-head no-print"><h1 class="head-title">標籤</h1><div class="spacer"></div>
        ${niim ? '<button class="btn" data-act="label-disconnect">中斷連線</button>' : `${canUsb() ? '<button class="btn" data-act="label-connect" data-via="usb">🔌 USB 連線</button>' : ''}${canBt() ? '<button class="btn" data-act="label-connect" data-via="bt">📶 藍牙連線</button>' : ''}`}
        ${IS_DESKTOP ? '<button class="btn primary" data-act="label-browser">🖨 用瀏覽器列印到 B3S</button>' : ''}
        ${canUsb() || canBt() ? '<button class="btn primary" data-act="label-print">🖨 列印</button>' : ''}</div>
      <div class="label-grid no-print">
        <section class="card label-saved">
          <div class="sec-head"><h2>已儲存的標籤</h2><span class="muted small">（${c.saved.length}）</span><div class="spacer"></div>
            ${c.saved.length ? `<input id="labelQ" class="label-q" type="search" placeholder="搜尋品名…" value="${esc(labelQ)}">` : ''}</div>
          <div class="label-list" id="labelList">${labelSavedHtml()}</div>
        </section>
        <section class="card">
          <div class="sec-head"><h2>內容</h2><div class="spacer"></div><button class="btn sm primary" data-act="label-save">⭐ 儲存這張標籤</button></div>
          <div class="label-form">
            ${inp('name', '品名', f.name, 'list="dl-label" class="label-name"')}
            <datalist id="dl-label">${names.map(n => `<option value="${esc(n)}">`).join('')}</datalist>
            ${inp('qty', '份量（可留空）', f.qty, 'placeholder="例如 2 公斤"')}
            ${inp('made', '製造日期（清空就不印）', labelMade(), 'type="date"')}
            ${inp('days', '保存天數', c.days, 'inputmode="numeric" data-ime="en" placeholder="例如 3"')}
            <label class="fld">到期日<input id="labelExp" data-label="exp" type="date" value="${esc(labelExp())}"></label>
            ${inp('who', '人員（可留空）', c.who)}
            ${inp('note', '備註（可留空）', f.note, 'placeholder="例如 冷藏 0～7°C"')}
            ${inp('copies', '張數', c.copies, 'inputmode="numeric" data-ime="en"')}
          </div>
        </section>
        <section class="card">
          <h2>預覽</h2>
          <div class="label-stage"><canvas id="labelCv" class="label-cv"></canvas></div>
          <p class="small muted">${esc(c.w)} × ${esc(c.h)} 公釐，黑白 203 dpi，和印出來一樣。</p>
          <div class="label-status" id="labelStatus">${labelStatus()}</div>
          <div class="btn-row">
            <button class="btn" data-act="label-png">💾 存成圖片</button>
            ${IS_MOBILE ? '' : '<button class="btn" data-act="label-sys">🖨 系統列印</button>'}
            <button class="btn" data-act="label-a4">📄 A4 列印</button>
          </div>
          <div class="label-a4-opt">
            <label class="ck-lbl"><input type="checkbox" data-label="a4fill" ${c.a4fill ? 'checked' : ''}> A4 排滿整頁（不勾就照張數）</label>
            <span class="muted small" id="labelA4"></span>
          </div>
        </section>
        <section class="card">
          <h2>紙張</h2>
          <div class="label-form">
            <label class="fld">標籤紙尺寸（寬 × 高）<select data-label="size">
              ${LABEL_SIZES.map(([w, h]) => `<option value="${w}x${h}" ${w === c.w && h === c.h ? 'selected' : ''}>${w} × ${h} 公釐${w === LABEL_MAX_W ? '（75 寬的紙）' : ''}</option>`).join('')}
              <option value="" ${sized ? '' : 'selected'}>自訂</option></select></label>
            ${inp('w', '寬（公釐，最大 72）', c.w, 'inputmode="numeric" data-ime="en"')}
            ${inp('h', '高（公釐）', c.h, 'inputmode="numeric" data-ime="en"')}
            <label class="fld">紙張種類<select data-label="paper">
              <option value="1" ${+c.paper === 1 ? 'selected' : ''}>間隙紙（一般貼紙）</option>
              <option value="2" ${+c.paper === 2 ? 'selected' : ''}>黑標紙</option>
              <option value="3" ${+c.paper === 3 ? 'selected' : ''}>連續紙</option>
              <option value="5" ${+c.paper === 5 ? 'selected' : ''}>透明紙</option></select></label>
            <label class="fld">濃度<select data-label="density">${[1, 2, 3, 4, 5].map(d => `<option ${+c.density === d ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
          </div>
          <details class="label-adv"><summary>印不出來時</summary>
            <p class="small muted">預設用 B1 的傳輸方式。如果連得上卻印不出來，可以換 B21_V1 再試。</p>
            <label class="fld">傳輸方式<select data-label="task">
              <option value="" ${c.task ? '' : 'selected'}>自動</option>
              ${['B1', 'B21_V1'].map(t => `<option ${c.task === t ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
          </details>
        </section>
      </div>
    </div>`;
  }
  function onLabelInput(t) {
    const c = labelCfg(), k = t.dataset.label, v = t.value;
    if (k === 'a4fill') c.a4fill = t.checked;
    else if (k === 'name' || k === 'qty' || k === 'note') labelForm[k] = v;
    else if (k === 'made') labelForm.made = v;
    else if (k === 'exp') { labelForm.exp = v; c.days = ''; const d = $('[data-label="days"]'); if (d) d.value = ''; }
    else if (k === 'size') {
      if (!v) return;
      const [w, h] = v.split('x').map(Number);
      c.w = w; c.h = h; persist(); render(); return;
    }
    else if (k === 'w' || k === 'h') {
      const n = parseFloat(v), lo = k === 'w' ? 15 : 10, hi = k === 'w' ? LABEL_MAX_W : 200;
      if (!(n >= lo && n <= hi)) { t.classList.add('invalid'); return; }
      t.classList.remove('invalid');
      c[k] = Math.round(n);
    }
    else c[k] = k === 'paper' || k === 'density' || k === 'copies' ? Math.max(1, parseInt(v, 10) || 1) : v;
    persist(); updateLabel();
  }

  async function labelDisconnect() {
    const cl = niim;
    niim = null;
    try { await cl.disconnect(); } catch (e) { /* 已經斷了 */ }
    render();
  }
  async function labelConnect(via) {
    await loadJs(NIIM_LIB);
    const lib = window.niimbluelib, cl = via === 'usb' ? new lib.NiimbotSerialClient() : new lib.NiimbotBluetoothClient();
    cl.on('disconnect', () => { if (niim === cl) { niim = null; if (route.name === 'labels') render(); toast('印表機已斷線', 'err'); } });
    await cl.connect();
    niim = cl;
    if (route.name === 'labels') render();
    toast('已連線：' + ((cl.getModelMetadata() || {}).model || '印表機'));
    return true;
  }
  /** 送一張標籤到印表機；cl 可替換成測試用的假印表機 */
  async function labelSend(cl) {
    const c = labelCfg(), lib = window.niimbluelib, cv = drawLabel(document.createElement('canvas')), meta = cl.getModelMetadata() || {};
    if (meta.printheadPixels && cv.width > meta.printheadPixels) throw new Error(`標籤寬度超過印表機的 ${Math.floor(meta.printheadPixels / LABEL_DOTS)} 公釐`);
    const img = lib.ImageEncoder.encodeCanvas(cv, lib.PageColorType.SingleColor, meta.printDirection || 'top');
    const copies = Math.max(1, parseInt(c.copies, 10) || 1);
    // B3S 不在函式庫的對照表裡，回報可用的是 B1；D110 會印不停，所以不交給自動判斷
    const auto = /^B3S/.test(meta.model || '') ? 'B1' : cl.getPrintTaskType() || 'B1';
    const task = cl.protocol.newPrintTask(c.task || auto, {
      totalPages: copies, density: +c.density || 3, labelType: +c.paper || 1, pageColor: lib.PageColorType.SingleColor, statusPollIntervalMs: 100, statusTimeoutMs: 8000,
    });
    try {
      await task.printInit();
      await task.printPage(img, copies);
      await task.waitForPageFinished();
      await task.waitForFinished();
    } finally { await cl.protocol.printEnd(); }
    return copies;
  }
  async function labelPrint() {
    if (!labelForm.name.trim()) { toast('請先填品名', 'err'); const n = $('[data-label="name"]'); if (n) n.focus(); return; }
    if (!niim) return toast('請先連線印表機', 'err');
    try {
      toast('列印中…');
      toast(`已列印 ${await labelSend(niim)} 張`);
    } catch (e) {
      toast('列印失敗：' + e.message, 'err');
    }
  }
  async function labelPng() {
    const cv = drawLabel(document.createElement('canvas')), name = `標籤_${labelForm.name.trim() || '未命名'}.png`.replace(/[\\/:*?"<>|]/g, '_');
    if (IS_DESKTOP) {
      const p = await (await desktopApi()).export_image(cv.toDataURL('image/png'), name);
      if (p) toast('已存到 ' + p);
      return;
    }
    const blob = await new Promise(r => cv.toBlob(r, 'image/png')), file = new File([blob], name, { type: 'image/png' });
    const canShare = (() => { try { return IS_MOBILE && !!navigator.canShare && navigator.canShare({ files: [file] }); } catch (e) { return false; } })();
    if (canShare) {
      try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    const url = URL.createObjectURL(file), a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  /** 系統列印：放在獨立的列印頁面，不受主畫面樣式影響；紙張大小就是標籤尺寸，等圖片解碼完才印 */
  async function labelSys() {
    const c = labelCfg(), src = drawLabel(document.createElement('canvas')).toDataURL('image/png');
    const n = Math.min(99, Math.max(1, parseInt(c.copies, 10) || 1));
    await printFrame(`<!doctype html><html><head><meta charset="utf-8"><title>標籤</title><style>
      @page { size: ${c.w}mm ${c.h}mm; margin: 0; }
      html, body { margin: 0; padding: 0; background: #fff; }
      img { display: block; width: ${c.w}mm; height: ${c.h}mm; break-inside: avoid; }
      img + img { break-before: page; }
    </style></head><body>${Array.from({ length: n }, () => `<img src="${src}" alt="">`).join('')}</body></html>`);
  }
  async function printFrame(html) {
    const fr = document.createElement('iframe');
    fr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    fr.srcdoc = html;
    await new Promise(res => { fr.onload = res; document.body.appendChild(fr); });
    try {
      const w = fr.contentWindow;
      await Promise.all([...w.document.images].map(i => i.decode()));
      w.focus();
      w.print();
    } catch (e) { toast('列印失敗：' + e.message, 'err'); }
    setTimeout(() => fr.remove(), 60000);
  }
  // A4 排版：四邊留 10 公釐給印表機，標籤緊貼排列，虛線就是裁切線
  const A4_W = 210, A4_H = 297, A4_M = 10;
  function a4Grid() {
    const c = labelCfg(), cols = Math.max(1, Math.floor((A4_W - A4_M * 2) / c.w)), rows = Math.max(1, Math.floor((A4_H - A4_M * 2) / c.h));
    const per = cols * rows, want = c.a4fill ? per : Math.max(1, parseInt(c.copies, 10) || 1);
    return { cols, rows, per, want: Math.min(want, per * 20), w: c.w, h: c.h };
  }
  function a4Html(src) {
    const g = a4Grid(), pages = [];
    for (let i = 0; i < g.want; i += g.per) pages.push(Math.min(g.per, g.want - i));
    return `<!doctype html><html><head><meta charset="utf-8"><title>標籤 A4</title><style>
      @page { size: A4; margin: 0; }
      html, body { margin: 0; padding: 0; background: #fff; }
      .sheet { width: ${A4_W}mm; height: ${A4_H - 1}mm; padding: ${A4_M}mm; box-sizing: border-box; overflow: hidden; display: grid; grid-template-columns: repeat(${g.cols}, ${g.w}mm); grid-auto-rows: ${g.h}mm; justify-content: center; align-content: start; }
      .sheet + .sheet { break-before: page; }
      img { display: block; width: ${g.w}mm; height: ${g.h}mm; box-sizing: border-box; border: .2mm dashed #999; }
    </style></head><body>${pages.map(n => `<div class="sheet">${`<img src="${src}" alt="">`.repeat(n)}</div>`).join('')}</body></html>`;
  }
  async function labelA4Pdf() {
    await loadJs(PDF_LIBS[1]);
    const g = a4Grid(), src = drawLabel(document.createElement('canvas'), LABEL_DOTS * 2).toDataURL('image/png');
    const pdf = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4' });
    const x0 = (A4_W - g.cols * g.w) / 2;
    pdf.setDrawColor(153); pdf.setLineDashPattern([1, 1], 0); pdf.setLineWidth(0.2);
    for (let i = 0; i < g.want; i++) {
      const k = i % g.per;
      if (i && !k) pdf.addPage();
      const x = x0 + (k % g.cols) * g.w, y = A4_M + Math.floor(k / g.cols) * g.h;
      pdf.addImage(src, 'PNG', x, y, g.w, g.h, 'label', 'FAST');
      pdf.rect(x, y, g.w, g.h);
    }
    return new File([pdf.output('blob')], `標籤_${labelForm.name.trim() || '未命名'}_A4.pdf`.replace(/[\/:*?"<>|]/g, '_'), { type: 'application/pdf' });
  }
  async function labelA4() {
    if (!labelForm.name.trim()) { toast('請先填品名', 'err'); const n = $('[data-label="name"]'); if (n) n.focus(); return; }
    if (IS_MOBILE) return sharePdf(labelA4Pdf);
    await printFrame(a4Html(drawLabel(document.createElement('canvas'), LABEL_DOTS * 2).toDataURL('image/png')));
  }
  async function labelBrowser() {
    const c = labelCfg(), f = { ...labelForm, made: labelMade(), exp: labelExp() };
    const job = JSON.stringify({ cfg: { w: c.w, h: c.h, days: c.days, who: c.who, copies: c.copies, density: c.density, paper: c.paper, task: c.task }, form: f });
    await (await desktopApi()).open_url(LABEL_SITE + '#/labels/' + encodeURIComponent(job));
    toast('已在瀏覽器開啟；要用 Edge 或 Chrome 才能連印表機');
  }

  // ---------------------------------------------------------------- 小抄
  // 存在 settings.cheat，跟著設定一起同步到雲端
  const CHEAT_DEF = { items: [], ing: true, steps: 'key', notes: true, cost: false, vi: true, layout: 'two', size: 'm' };
  function cheatCfg() {
    const c = Object.assign({}, CHEAT_DEF, db.settings.cheat || {});
    const ids = new Set(db.recipes.map(r => r.id));
    c.items = (Array.isArray(c.items) ? c.items : []).filter(x => x && (x.type === 'note' || ids.has(x.recipeId)));
    // 食譜自動成為卡片：還沒有卡片的接在最後，順序之後可以拖曳；不想印的用 off 隱藏，才不會又被加回來
    const has = new Set(c.items.map(x => x.recipeId));
    db.recipes.filter(r => !has.has(r.id))
      .sort((a, b) => a.category.localeCompare(b.category, 'zh-Hant') || a.name.localeCompare(b.name, 'zh-Hant'))
      .forEach(r => c.items.push({ type: 'recipe', recipeId: r.id, mult: 1 }));
    return (db.settings.cheat = c);
  }
  const cheatShown = c => c.items.filter(x => !x.off);
  function cheatAddRecipe(id, mult) {
    const c = cheatCfg(), it = c.items.find(x => x.type !== 'note' && x.recipeId === id);
    if (it) { it.mult = mult; delete it.off; } else c.items.push({ type: 'recipe', recipeId: id, mult });
  }

  // 卡片清單（在「編輯卡片」彈跳視窗裡）
  function cheatItemsHtml() {
    const c = cheatCfg();
    return c.items.map((it, k) => {
      const mv = `<button class="icon" data-act="cheat-mv" data-k="${k}" data-d="-1" title="上移">↑</button><button class="icon" data-act="cheat-mv" data-k="${k}" data-d="1" title="下移">↓</button>`;
      const tools = `${mv}<button class="icon danger" data-act="cheat-rm" data-k="${k}" title="${it.type === 'note' ? '刪除這張文字卡' : '隱藏這張卡片，食譜不會被刪除'}">✕</button>`;
      if (it.type === 'note') return `<div class="cheat-item note">
        <div class="ci-row">${DRAG}<input type="text" placeholder="卡片標題（例如：出餐順序、注意事項）" data-cheat-note="${k}" data-f="title" value="${esc(it.title || '')}">${tools}</div>
        <textarea rows="3" placeholder="內容，一行一點" data-cheat-note="${k}" data-f="text">${esc(it.text || '')}</textarea></div>`;
      const r = getRecipe(it.recipeId);
      if (it.off) return `<div class="cheat-item off"><div class="ci-row">${DRAG}<span class="pname">${esc(r.name)}</span><span class="badge">已隱藏</span><div class="spacer"></div>
        ${mv}<button class="btn sm" data-act="cheat-show" data-k="${k}">顯示</button></div></div>`;
      return `<div class="cheat-item"><div class="ci-row">${DRAG}<span class="pname">${esc(r.name)}</span>
        <label class="inline">×<input type="text" autocomplete="off" placeholder="2 或 /3" data-cheat-mult="${k}" value="${multText(it.mult)}"></label>
        <span class="muted small" id="cy${k}">${fmt(r.yieldQty * it.mult)} ${esc(r.yieldUnit)}</span>${tools}</div>
        <textarea rows="${Math.max(2, r.steps.length)}" placeholder="製作步驟，一行一步（會存回這道食譜）" data-cheat-steps="${k}">${esc(r.steps.map(s => s.text).join('\n'))}</textarea></div>`;
    }).join('') || '<p class="muted">尚未加入卡片。</p>';
  }
  /** 小抄裡改步驟＝改食譜本身；沒改到的行保留原本的計時、重點、越南文 */
  function cheatSetSteps(r, text) {
    const old = r.steps, used = new Set();
    // 頭尾相同的字數過半才算同一步改字；整句換掉就是新步驟，不沿用舊的計時和重點
    const alike = (x, y) => {
      let p = 0, q = 0;
      while (p < x.length && x[p] === y[p]) p++;
      while (q < x.length - p && q < y.length - p && x[x.length - 1 - q] === y[y.length - 1 - q]) q++;
      return (p + q) * 2 >= Math.max(x.length, y.length);
    };
    const lines = text.split('\n').map(x => x.trim()).filter(Boolean);
    const same = lines.map(l => { const s = old.find(x => x.text === l && !used.has(x)); if (s) used.add(s); return s; });
    r.steps = lines.map((l, k) => {
      if (same[k]) return same[k];
      if (old[k] && !used.has(old[k]) && alike(old[k].text, l)) { used.add(old[k]); return { ...old[k], text: l, textVi: '' }; }
      return { id: uid(), text: l, minutes: null, key: old.some(x => x.key), textVi: '' }; // 這道菜有標重點時，新打的也算重點，才會出現在卡片上
    });
    r.updatedAt = Date.now();
  }

  function openCheatEditor() {
    const m = $('#modal');
    m.innerHTML = `<div class="modal-back" data-cheat-back><div class="modal cheat-modal" id="cheatEditor" role="dialog" aria-modal="true">
        <div class="cm-head"><h3>編輯小抄卡片</h3><div class="spacer"></div><button class="icon" data-act="cheat-close" title="關閉">✕</button></div>
        <p class="hint">所有食譜都會自動變成卡片，新增的排在最後，刪除食譜時卡片也會移除。按住 ⠿ 拖曳可以調整順序，不想印的按 ✕ 隱藏。每道菜下方的框可以直接打步驟，一行一步，會存回食譜。</p>
        <div class="cm-scroll"><div class="cheat-items" id="cheatItems"></div></div>
        <div class="plan-add cm-add">
          <button class="btn" data-act="cheat-note">＋ 文字卡</button>
          ${db.plan.length ? '<button class="btn" data-act="cheat-from-plan">從備料單匯入</button>' : ''}
        </div>
        <div class="modal-btns"><button class="btn primary" data-act="cheat-close">完成</button></div>
      </div></div>`;
    m.classList.add('open');
    $('#cheatItems').innerHTML = cheatItemsHtml();
    m.onkeydown = e => { if (e.key === 'Escape') { e.preventDefault(); closeCheatEditor(); } };
    const ed = $('#cheatEditor'); ed.tabIndex = -1; ed.focus(); // 讓 Esc 能關閉視窗
  }
  function closeCheatEditor() {
    const m = $('#modal');
    if (!$('#cheatEditor')) return;
    m.classList.remove('open'); m.innerHTML = ''; m.onkeydown = null;
    if (route.name === 'cheat') render();
    setTimeout(autoTranslate, 300);
  }
  /** 卡片有增減或換順序：更新彈跳視窗裡的清單與頁面上的預覽 */
  function refreshCheat(focusLastNote) {
    const box = $('#cheatItems');
    if (box) {
      box.innerHTML = cheatItemsHtml();
      if (focusLastNote) { const t = $$('#cheatItems [data-cheat-note][data-f="title"]').pop(); if (t) t.focus(); }
    }
    if (route.name === 'cheat') { const y = window.scrollY; render(); window.scrollTo(0, y); }
  }

  function viewCheat() {
    const c = cheatCfg(), shown = cheatShown(c).length;
    const opt = (k, v, t) => `<option value="${v}" ${c[k] === v ? 'selected' : ''}>${t}</option>`;
    const box = (k, t) => `<label class="ck-lbl"><input type="checkbox" data-cheat-opt="${k}" ${c[k] ? 'checked' : ''}> ${t}</label>`;
    return `<div class="page cheat-page">
      <div class="page-head no-print"><h1 class="head-title">小抄</h1><div class="spacer"></div>
        <button class="btn" data-act="cheat-edit">📋 編輯卡片（${shown}）</button>
        ${shown ? '<button class="btn primary" data-act="cheat-print">🖨 列印小抄</button><button class="btn ghost" data-act="cheat-clear">清空</button>' : ''}</div>
      ${shown ? '' : c.items.length ? `<div class="empty no-print"><p>卡片都隱藏了。</p><button class="btn primary" data-act="cheat-edit">重新顯示卡片</button></div>`
        : `<div class="empty no-print"><p>還沒有小抄卡片，新增食譜後會自動出現在這裡。</p><a class="btn primary" href="#/new">＋ 新增食譜</a> <button class="btn" data-act="cheat-edit">＋ 文字卡</button></div>`}
      <section class="card no-print">
        <h2>內容與版面</h2>
        <div class="cheat-opts">
          ${box('ing', '食材用量')}${box('notes', '食譜備註')}${box('cost', '成本')}${box('vi', '越南文（Tiếng Việt）')}
          <label class="fld inline-fld">步驟<select data-cheat-opt="steps">${opt('steps', 'key', '只列重點步驟')}${opt('steps', 'all', '全部步驟')}${opt('steps', 'none', '不列步驟')}</select></label>
          <label class="fld inline-fld">版面<select data-cheat-opt="layout">${opt('layout', 'two', '兩欄小卡')}${opt('layout', 'one', '單欄')}${opt('layout', 'page', '一頁一張')}</select></label>
          <label class="fld inline-fld">字級<select data-cheat-opt="size">${opt('size', 's', '小')}${opt('size', 'm', '中')}${opt('size', 'l', '大')}</select></label>
          <label class="fld inline-fld">單位${unitModeSelect('unitMode4')}</label>
        </div>
      </section>
      <div id="cheatCards"></div>
    </div>`;
  }

  const DRAG = '<span class="drag no-print" data-drag title="拖曳調整順序">⠿</span>';

  // 拖曳排序（滑鼠與觸控都用 pointer 事件）：拖動時直接移動畫面上的元素，放開後才寫回資料
  function startDrag(e, handle) {
    const box = handle.closest('.cheat-items, #cheatCards');
    const sel = box.id === 'cheatCards' ? '.cheat-card' : '.cheat-item';
    const item = handle.closest(sel), list = () => [...box.querySelectorAll(sel)];
    const from = list().indexOf(item);
    if (from < 0) return;
    e.preventDefault();
    item.classList.add('dragging');
    const move = ev => {
      const sc = box.closest('.cm-scroll'); // 彈跳視窗裡捲動清單本身
      if (sc) { const b = sc.getBoundingClientRect(); if (ev.clientY < b.top + 40) sc.scrollTop -= 12; else if (ev.clientY > b.bottom - 40) sc.scrollTop += 12; }
      else { const edge = 60, h = window.innerHeight; if (ev.clientY < edge) window.scrollBy(0, -12); else if (ev.clientY > h - edge) window.scrollBy(0, 12); }
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const over = el && el.closest(sel);
      if (!over || over === item || over.parentNode !== box) return;
      // 換位置後指標要仍在被拖曳的卡片上，否則卡片高度不同時會來回跳
      const r = over.getBoundingClientRect(), ir = item.getBoundingClientRect();
      const down = list().indexOf(over) > list().indexOf(item);
      const sameRow = Math.abs(r.top - ir.top) < 10;
      const mid = r.top + r.height / 2;
      if (!sameRow && (down ? ev.clientY < Math.min(mid, r.bottom - ir.height) : ev.clientY > Math.max(mid, r.top + ir.height))) return;
      box.insertBefore(item, down ? over.nextSibling : over);
    };
    // 監聽 window：元素在 DOM 中移動時會失去 pointer capture
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      item.classList.remove('dragging');
      const to = list().indexOf(item);
      if (to === from) return;
      const a = cheatCfg().items, vis = box.id === 'cheatCards' ? a.filter(y => !y.off) : [...a];
      const [x] = vis.splice(from, 1), next = vis[to];
      a.splice(a.indexOf(x), 1);
      if (next) a.splice(a.indexOf(next), 0, x); else a.push(x);
      persist();
      const sc = box.closest('.cm-scroll'), st = sc && sc.scrollTop;
      refreshCheat();
      if (sc) sc.scrollTop = st;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }
  document.addEventListener('pointerdown', e => {
    const h = e.target.closest('[data-drag]');
    if (h && (e.button === 0 || e.pointerType !== 'mouse')) startDrag(e, h);
  });

  function cheatCard(it, c) {
    if (it.type === 'note') {
      const split = t => String(t || '').split('\n').map(x => x.trim()).filter(Boolean);
      const lines = split(it.text), vis = split(it.textVi);
      const paired = vis.length === lines.length;
      return `<article class="cheat-card"><header>${DRAG}<h3>${it.title ? bv(it.title, it.titleVi) : bt('小抄')}</h3></header>
        ${lines.length ? `<ul class="cc-list">${lines.map((l, k) => `<li>${bv(l, paired ? vis[k] : '')}</li>`).join('')}</ul>
        ${!paired && viOn() && vis.length ? `<ul class="cc-list vi" lang="vi">${vis.map(l => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}` : `<p class="muted">${bt('（尚未填寫內容）')}</p>`}</article>`;
    }
    const r = getRecipe(it.recipeId), mult = it.mult, mode = db.settings.unitMode;
    let body = '';
    if (c.ing && r.ingredients.length) {
      let last = null, rows = '';
      for (const i of r.ingredients) {
        const g = i.group.trim();
        if (g !== (last || '') && (g || last) && !(isHead(i) && !g)) rows += `<div class="cc-grp">${g ? bv(g, i.groupVi) : bt('其他')}</div>`;
        last = g;
        if (isHead(i)) { rows += `<div class="cc-grp cc-sub">${bv(i.name, i.nameVi || trVi(i.name))}</div>`; continue; }
        const d = U.display(i.qty == null ? null : i.qty * mult, i.unit, mode);
        rows += `<div class="cc-ing"><span>${bv(i.name, i.nameVi || trVi(i.name))}</span><b>${bt(d.text)}</b></div>`;
      }
      body += `<div class="cc-ings">${rows}</div>`;
    }
    // 只列重點：這道菜沒有標重點的話就全部列出，不然打了步驟也看不到
    const keyOnly = c.steps === 'key' && r.steps.some(s => s.key);
    const steps = c.steps === 'none' ? [] : r.steps.map((s, k) => ({ ...s, n: k + 1 })).filter(s => !keyOnly || s.key);
    if (steps.length) body += `<ol class="cc-steps">${steps.map(s => `<li value="${s.n}" class="${s.key ? 'key' : ''}">${bvML((s.key && c.steps === 'all' ? '★ ' : '') + s.text, s.textVi)}${s.minutes ? ` <span class="cc-min">⏱${fmt(s.minutes)} 分${viOn() ? ' (phút)' : ''}</span>` : ''}</li>`).join('')}</ol>`;
    if (c.notes && r.notes.trim()) body += `<div class="cc-notes">${bvML(r.notes.trim(), r.notesVi)}</div>`;
    if (c.cost) { const k = recipeCost(r, mult, priceMap()); body += `<div class="cc-cost">${bt(`成本 ${money(k.total)}　每${r.yieldUnit} ${money(k.perUnit)}${k.missing ? '（部分未計）' : ''}`)}</div>`; }
    return `<article class="cheat-card"><header>${DRAG}<h3>${bv(r.name, r.nameVi)}</h3>
      <span class="cc-scale">${bt(`${mult === 1 ? '' : `× ${multText(mult)}　`}${fmt(r.yieldQty * mult)} ${r.yieldUnit}`)}</span></header>${body || `<p class="muted">${bt('（沒有勾選要顯示的內容）')}</p>`}</article>`;
  }

  // ---- 手機列印：iPhone 主畫面 App 不支援 window.print()，改成產生 A4 PDF，再用分享選單列印／存檔／傳 LINE
  const IS_MOBILE = !IS_DESKTOP && (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1));
  const PDF_LIBS = ['https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js', 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'];
  const loadedJs = {};
  const loadJs = src => loadedJs[src] || (loadedJs[src] = new Promise((res, rej) => {
    const el = document.createElement('script');
    el.src = src; el.onload = res;
    el.onerror = () => { delete loadedJs[src]; rej(new Error('無法載入列印元件，請確認網路')); };
    document.head.appendChild(el);
  }));

  // 每張卡片各自截圖，依版面排進 A4 頁面，卡片不會被切成兩半
  async function buildCheatPdf() {
    await Promise.all(PDF_LIBS.map(loadJs));
    const c = cheatCfg();
    const PAGE_W = 210, PAGE_H = 297, M = 10, GAP = 4;          // mm
    const CONTENT_PX = 718, mmPerPx = (PAGE_W - M * 2) / CONTENT_PX; // A4 內容寬約 718 CSS px
    const two = c.layout === 'two', colPx = two ? (CONTENT_PX - GAP / mmPerPx) / 2 : CONTENT_PX;
    const host = document.createElement('div');
    host.className = `pdf-render cheat-grid lay-one fs-${c.size}`;
    host.style.cssText = `position:fixed;left:-10000px;top:0;width:${colPx}px`;
    host.innerHTML = cheatShown(c).map(it => cheatCard(it, c)).join('');
    document.body.appendChild(host);
    try {
      const imgs = [];
      for (const card of host.querySelectorAll('.cheat-card')) {
        const cv = await window.html2canvas(card, { scale: 2, backgroundColor: '#ffffff' });
        imgs.push({ data: cv.toDataURL('image/jpeg', 0.9), w: colPx * mmPerPx, h: cv.height / 2 * mmPerPx });
      }
      const pdf = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4' });
      const maxH = PAGE_H - M * 2;
      let y = M, first = true;
      const place = (img, x, top) => {
        const k = Math.min(1, maxH / img.h); // 比一頁還高的卡片縮小放進一頁
        pdf.addImage(img.data, 'JPEG', x, top, img.w * k, img.h * k);
        return img.h * k;
      };
      const newPage = () => { if (!first) pdf.addPage(); first = false; y = M; };
      newPage();
      const per = two ? 2 : 1;
      for (let i = 0; i < imgs.length; i += per) {
        const row = imgs.slice(i, i + per);
        const rowH = Math.min(maxH, Math.max(...row.map(r => r.h)));
        if (c.layout === 'page' ? i > 0 : y + rowH > PAGE_H - M && y > M) newPage();
        row.forEach((img, k) => place(img, M + k * (img.w + GAP), y));
        y += rowH + GAP;
      }
      return new File([pdf.output('blob')], `小抄_${dateStr()}.pdf`, { type: 'application/pdf' });
    } finally { host.remove(); }
  }

  async function cheatPdf() {
    if (!cheatShown(cheatCfg()).length) return toast('請先顯示卡片');
    sharePdf(buildCheatPdf);
  }
  async function sharePdf(build) {
    toast('正在產生 PDF…');
    let file;
    try { file = await build(); } catch (e) { return toast('產生 PDF 失敗：' + e.message, 'err'); }
    const canShare = (() => { try { return !!navigator.canShare && navigator.canShare({ files: [file] }); } catch (e) { return false; } })();
    const url = URL.createObjectURL(file);
    // 產生 PDF 需要一點時間，iOS 會認為已不是使用者點的，所以再請使用者點一次「分享／列印」
    const act = await modal({
      title: 'PDF 已準備好',
      body: `<p>${canShare ? '按「分享／列印」後，在分享選單選「列印」即可用印表機列印，也可以存到檔案或傳 LINE。' : '按「開啟 PDF」後，用瀏覽器的列印或分享功能列印。'}</p>`,
      buttons: [{ label: '關閉', value: null }, ...(canShare ? [{ label: '開啟 PDF', value: 'open' }, { label: '分享／列印', cls: 'primary', value: 'share' }] : [{ label: '開啟 PDF', cls: 'primary', value: 'open' }])],
    });
    if (act === 'share') {
      try { await navigator.share({ files: [file], title: file.name }); }
      catch (e) { if (e.name !== 'AbortError') { window.open(url, '_blank'); } }
    } else if (act === 'open') {
      const w = window.open(url, '_blank');
      if (!w) { const a = document.createElement('a'); a.href = url; a.download = file.name; document.body.appendChild(a); a.click(); a.remove(); }
    }
    setTimeout(() => URL.revokeObjectURL(url), 120000);
  }

  function updateCheat() {
    const el = $('#cheatCards');
    if (!el) return;
    const c = cheatCfg();
    el.className = `cheat-grid lay-${c.layout} fs-${c.size}`;
    el.innerHTML = cheatShown(c).map(it => cheatCard(it, c)).join('');
  }

  // ---------------------------------------------------------------- SOP 主資料
  // 依紙本「單點 SOP」表單：食材明細、使用份量、廠商、規格、進價、耗損 → 自動算採購份量、成本、成本合計、售價、毛利
  const TAX = 0.05; // 營業稅 5%：含稅售價 = 淨售價 × 1.05
  const getSop = id => db.sops.find(o => o.id === id);
  const n2 = v => (v == null || !isFinite(v) ? '' : (Math.round(v * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const money2 = v => (v == null || !isFinite(v) ? '—' : '$' + n2(v));

  // 欄位裡多打的「%」「$」「元」、千分位逗號都忽略
  const sopNum = v => num(String(v == null ? '' : v).replace(/[%％$＄元,，\s]/g, ''));
  function sopRowCalc(x) {
    const q = sopNum(x.qty), loss = Math.min(99, Math.max(0, sopNum(x.loss) || 0)), sq = sopNum(x.specQty), pr = sopNum(x.price);
    const buy = q == null ? null : q / (1 - loss / 100);            // 採購份量（含損耗）
    let cost = null, err = '';
    if (buy != null && sq && pr != null) {
      const c = U.convert(buy, x.unit, x.specUnit);
      if (c == null) err = '單位不符'; else cost = c / sq * pr;     // 成本 = 採購份量 ÷ 規格 × 進價
    }
    return { buy, cost, err };
  }
  function sopTotals(o) {
    let cost = 0, missing = 0;
    for (const x of o.rows) {
      if (!x.name.trim()) continue;
      const c = sopRowCalc(x);
      if (c.cost != null) cost += c.cost; else if (sopNum(x.qty) != null) missing++;
    }
    const net = sopNum(o.net), gross = sopNum(o.gross);
    const profit = net == null ? null : net - cost;
    return { cost: Math.round(cost * 100) / 100, missing, net, gross, profit, margin: net ? profit / net : null };
  }

  let sopFilter = '';
  function viewSops() {
    return `<div class="page">
      <div class="page-head"><h1 class="head-title">SOP 主資料</h1><div class="spacer"></div>
        <label class="btn">📷 從照片建立<input type="file" accept="image/*" data-act-change="sop-ocr-new" hidden></label>
        <button class="btn primary" data-act="sop-new">＋ 新增 SOP</button></div>
      <p class="muted">依紙本 SOP 表單建立每道品項的主資料：填入使用份量、規格、進價、耗損，自動算出採購份量、成本、成本合計與毛利。</p>
      <input id="sopq" class="search" type="search" placeholder="搜尋 SOP 名稱或食材…" value="${esc(sopFilter)}" autocomplete="off">
      <div class="grid" id="sopList"></div>
    </div>`;
  }
  function updateSopList() {
    const el = $('#sopList');
    if (!el) return;
    const q = normName(sopFilter);
    const list = db.sops.filter(o => !q || normName(o.title).includes(q) || o.rows.some(x => normName(x.name).includes(q)))
      .sort((a, b) => a.title.localeCompare(b.title, 'zh-Hant'));
    if (!db.sops.length) { el.innerHTML = '<div class="empty"><p>還沒有 SOP 主資料。</p><button class="btn primary" data-act="sop-new">＋ 新增 SOP</button></div>'; return; }
    if (!list.length) { el.innerHTML = '<div class="empty"><p>沒有符合的 SOP。</p></div>'; return; }
    el.innerHTML = list.map(o => {
      const t = sopTotals(o), n = o.rows.filter(x => x.name.trim()).length;
      return `<a class="rcard" href="#/sop/${encodeURIComponent(o.id)}">
        <div class="thumb">${o.photo ? `<img src="${o.photo}" alt="">` : '<span>📋</span>'}</div>
        <div class="rcard-body">
          <div class="rname">${esc(o.title || '未命名 SOP')}</div>
          <div class="muted small">${n} 項食材 · 成本 ${money2(t.cost)}${t.net != null ? ` · 淨售價 ${money2(t.net)}` : ''}</div>
          ${t.margin != null ? `<div class="small cost-line">毛利 ${money2(t.profit)}（${(t.margin * 100).toFixed(1)}%）</div>` : ''}
          ${o.review.result ? `<div class="small"><span class="badge ${o.review.result === 'pass' ? '' : 'red'}">${o.review.result === 'pass' ? '考核通過' : '考核不通過'}</span></div>` : ''}
        </div></a>`;
    }).join('');
  }

  function viewSop(id) {
    const o = getSop(id);
    if (!o) return `<div class="page"><div class="empty"><p>找不到這份 SOP，可能已被刪除。</p><a class="btn primary" href="#/sops">回 SOP 列表</a></div></div>`;
    const rv = o.review;
    const inp = (f, v, extra = '') => `<input data-sop="${f}" value="${esc(v)}" ${extra}>`;
    const rows = o.rows.map((x, k) => `<tr data-k="${k}">
        <td class="no">${k + 1}</td>
        <td><input class="w-name" data-sop-row="${k}.name" value="${esc(x.name)}" placeholder="食材明細" list="dl-names"></td>
        <td><input class="w-num" data-sop-row="${k}.qty" value="${esc(x.qty)}" inputmode="decimal"></td>
        <td><input class="w-unit" data-sop-row="${k}.unit" value="${esc(x.unit)}" list="dl-units"></td>
        <td><input class="w-vendor" data-sop-row="${k}.vendor" value="${esc(x.vendor)}" placeholder="廠商/品牌" list="dl-vendors"></td>
        <td><input class="w-num" data-sop-row="${k}.specQty" value="${esc(x.specQty)}" inputmode="decimal"></td>
        <td><input class="w-unit" data-sop-row="${k}.specUnit" value="${esc(x.specUnit)}" list="dl-units"></td>
        <td><input class="w-num" data-sop-row="${k}.price" value="${esc(x.price)}" inputmode="decimal"></td>
        <td class="calc" id="sb${k}"></td>
        <td class="calc" id="sc${k}"></td>
        <td><input class="w-yield" data-sop-row="${k}.yieldText" value="${esc(x.yieldText)}"></td>
        <td><span class="pct"><input class="w-loss" data-sop-row="${k}.loss" value="${esc(x.loss)}" inputmode="decimal">%</span></td>
        <td class="row-btns no-print">
          <button class="icon" data-act="sop-row-mv" data-k="${k}" data-d="-1" ${k === 0 ? 'disabled' : ''} title="上移">↑</button>
          <button class="icon danger" data-act="sop-row-rm" data-k="${k}" title="刪除">✕</button></td>
      </tr>`).join('');
    const names = [...new Set([...db.prices.map(p => p.name), ...db.recipes.flatMap(r => r.ingredients.filter(i => !isHead(i)).map(i => i.name))].map(x => x.trim()).filter(Boolean))];
    const vendors = [...new Set(db.sops.flatMap(x => x.rows.map(r => r.vendor.trim())).filter(Boolean))];
    return `<div class="page sop-page">
      <div class="page-head no-print">
        <a class="btn ghost" href="#/sops">← SOP 列表</a><div class="spacer"></div>
        <label class="btn">📷 照片辨識<input type="file" accept="image/*" data-act-change="sop-ocr" hidden></label>
        <button class="btn" data-act="sop-from-recipe">從食譜帶入</button>
        <button class="btn" data-act="sop-print">🖨 列印</button>
        <button class="btn" data-act="sop-dup">複製</button>
        <button class="btn ghost" data-act="sop-del">刪除</button>
      </div>
      <div class="no-print">
      <section class="card sop-top">
        <label class="fld sop-title">品項名稱${inp('title', o.title, 'placeholder="例如：單點-肉品2026.06" autocomplete="off"')}</label>
        <div class="sop-review">
          <label class="fld">考核時間<input type="date" data-sop="review.date" value="${esc(rv.date)}"></label>
          <label class="fld">考核人${inp('review.reviewer', rv.reviewer)}</label>
          <label class="fld">被考核人${inp('review.reviewee', rv.reviewee)}</label>
          <div class="fld">考核結果<div class="radio-row">
            <label class="ck-lbl"><input type="radio" name="sopResult" value="pass" data-sop="review.result" ${rv.result === 'pass' ? 'checked' : ''}> 通過</label>
            <label class="ck-lbl"><input type="radio" name="sopResult" value="fail" data-sop="review.result" ${rv.result === 'fail' ? 'checked' : ''}> 不通過</label></div></div>
          <label class="fld">補考時間<input type="date" data-sop="review.retake" value="${esc(rv.retake)}"></label>
        </div>
      </section>

      <section class="card">
        <div class="sec-head"><h2>食材明細</h2><div class="spacer"></div><span class="muted small">灰底欄位自動計算</span></div>
        <div class="sop-table-wrap"><table class="sop-table">
          <thead><tr><th>NO</th><th>食材明細</th><th colspan="2">使用份量<small>（不含損耗）</small></th><th>廠商/品牌</th><th colspan="2">規格</th><th>進價<small>（未稅）</small></th>
            <th class="calc">採購份量<small>（含損耗）</small></th><th class="calc">成本</th><th>總製成量</th><th>耗損</th><th class="no-print"></th></tr></thead>
          <tbody id="sopRows">${rows}</tbody>
        </table></div>
        <div class="btn-row"><button class="btn" data-act="sop-row-add">＋ 新增食材</button></div>
        <p class="hint">採購份量 = 使用份量 ÷ (1 − 耗損%)；成本 = 採購份量 ÷ 規格 × 進價（單位不同會自動換算，例如公克對公斤、台斤）。食材名稱和單價表相同時，規格與進價會自動帶入。</p>
      </section>

      <section class="card">
        <h2>操作步驟</h2>
        <textarea data-sop="steps" rows="6" placeholder="一行一個步驟">${esc(o.steps)}</textarea>
      </section>

      <div class="sop-two">
        <section class="card">
          <h2>照片</h2>
          <div class="photo-row">
            ${o.photo ? `<img src="${o.photo}" alt="">` : '<div class="photo-ph">📷</div>'}
            <label class="btn">選擇照片<input type="file" accept="image/*" data-act-change="sop-photo" hidden></label>
            ${o.photo ? '<button class="btn ghost" data-act="sop-photo-rm">移除</button>' : ''}
          </div>
        </section>
        <section class="card">
          <h2>注意事項</h2>
          <textarea data-sop="notes" rows="5" placeholder="保存、衛生、出餐注意事項…">${esc(o.notes)}</textarea>
        </section>
      </div>

      <section class="card sop-sum">
        <div class="sum-cell calc"><span>成本合計</span><b id="sopCost"></b><small id="sopMiss"></small></div>
        <label class="sum-cell"><span>淨售價</span>${inp('net', o.net, 'inputmode="decimal" placeholder="0"')}</label>
        <label class="sum-cell"><span>含稅售價<small>（5%）</small></span>${inp('gross', o.gross, 'inputmode="decimal" placeholder="0"')}</label>
        <div class="sum-cell calc"><span>毛利</span><b id="sopProfit"></b><small id="sopMargin"></small></div>
        <label class="sum-cell"><span>製成量</span>${inp('yieldText', o.yieldText, 'placeholder="例如：1 份"')}</label>
      </section>
      </div>
      <div class="print-only" id="sopPrint"></div>
      <datalist id="dl-units">${COMMON_UNITS.concat(['公克', '公斤']).map(u => `<option value="${u}">`).join('')}</datalist>
      <datalist id="dl-names">${names.map(n => `<option value="${esc(n)}">`).join('')}</datalist>
      <datalist id="dl-vendors">${vendors.map(n => `<option value="${esc(n)}">`).join('')}</datalist>
    </div>`;
  }

  /** 只更新計算欄位，不重畫輸入框（打字、輸入法不會被打斷） */
  function updateSopCalc() {
    const o = getSop(route.id);
    if (!o || !$('#sopRows')) return;
    o.rows.forEach((x, k) => {
      const c = sopRowCalc(x), b = $('#sb' + k), co = $('#sc' + k);
      if (b) b.textContent = c.buy == null ? '' : `${n2(c.buy)} ${x.unit}`;
      if (co) co.innerHTML = c.err ? `<span class="warn">${c.err}</span>` : c.cost == null ? '' : money2(c.cost);
    });
    const t = sopTotals(o);
    $('#sopCost').textContent = money2(t.cost);
    $('#sopMiss').textContent = t.missing ? `${t.missing} 項未計入` : '';
    $('#sopProfit').textContent = t.profit == null ? '—' : money2(t.profit);
    $('#sopProfit').classList.toggle('warn', t.profit != null && t.profit < 0);
    $('#sopMargin').textContent = t.margin == null ? '' : `毛利率 ${(t.margin * 100).toFixed(1)}%`;
    const pr = $('#sopPrint');
    if (pr) pr.innerHTML = sopPrintHtml(o);
  }

  /** 列印用的表單（仿紙本格式） */
  function sopPrintHtml(o) {
    const t = sopTotals(o), rv = o.review;
    const box = on => (on ? '☑' : '☐');
    const filled = o.rows.filter(x => x.name.trim() || x.qty);
    const rows = filled.map((x, k) => { const c = sopRowCalc(x); return `<tr><td>${k + 1}</td><td class="l">${esc(x.name)}</td><td>${esc(x.qty)}</td><td>${esc(x.qty ? x.unit : '')}</td><td class="l">${esc(x.vendor)}</td>
      <td>${esc(x.specQty)}</td><td>${esc(x.specQty ? x.specUnit : '')}</td><td>${esc(x.price)}</td><td>${c.buy == null ? '' : n2(c.buy)}</td><td>${c.buy == null ? '' : esc(x.unit)}</td>
      <td>${c.cost == null ? esc(c.err) : n2(c.cost)}</td><td>${esc(x.yieldText)}</td><td>${x.loss !== '' ? esc(x.loss) + '%' : ''}</td></tr>`; });
    for (let k = filled.length; k < Math.max(12, filled.length); k++) rows.push(`<tr><td>${k + 1}</td>${'<td></td>'.repeat(12)}</tr>`);
    const steps = o.steps.split('\n').map(x => x.trim()).filter(Boolean);
    return `<div class="sop-print">
      <div class="sp-head"><h1>${esc(o.title || 'SOP')}</h1>
        <table class="sp-review"><tr><th>考核時間</th><td>${esc(rv.date)}</td><td>${box(rv.result === 'pass')} 通過</td></tr>
          <tr><th>考核人</th><td>${esc(rv.reviewer)}</td><td>${box(rv.result === 'fail')} 不通過</td></tr>
          <tr><th>被考核人</th><td>${esc(rv.reviewee)}</td><td>補考時間：${esc(rv.retake)}</td></tr></table></div>
      <table class="sp-table"><thead><tr><th>NO</th><th>食材明細</th><th colspan="2">使用份量<br>(不含損耗)</th><th>廠商/品牌</th><th colspan="2">規格</th><th>進價(未稅)</th>
        <th colspan="2">採購份量<br>(含損耗)</th><th>成本</th><th>總製成量</th><th>耗損%</th></tr></thead><tbody>${rows.join('')}</tbody></table>
      <div class="sp-band">操作步驟</div>
      <ol class="sp-steps">${steps.map(x => `<li>${esc(x)}</li>`).join('') || '<li class="muted">&nbsp;</li>'}</ol>
      <div class="sp-two"><div><div class="sp-band">照片</div><div class="sp-photo">${o.photo ? `<img src="${o.photo}" alt="">` : ''}</div></div>
        <div><div class="sp-band">注意事項</div><div class="sp-notes">${escML(o.notes)}</div></div></div>
      <table class="sp-sum"><tr><th>成本合計</th><th>淨售價</th><th>含稅售價</th><th>毛利</th><th>製成量</th></tr>
        <tr><td>${n2(t.cost)}</td><td>${t.net == null ? '' : n2(t.net)}</td><td>${t.gross == null ? '' : n2(t.gross)}</td>
          <td>${t.profit == null ? '' : n2(t.profit) + (t.margin == null ? '' : `（${(t.margin * 100).toFixed(1)}%）`)}</td><td>${esc(o.yieldText)}</td></tr></table>
    </div>`;
  }

  // 手機：產生 A4 PDF（太長就分頁）
  async function buildSopPdf(o) {
    await Promise.all(PDF_LIBS.map(loadJs));
    const host = document.createElement('div');
    host.className = 'pdf-render sop-pdf';
    host.style.cssText = 'position:fixed;left:-10000px;top:0;width:760px';
    host.innerHTML = sopPrintHtml(o);
    document.body.appendChild(host);
    try {
      await Promise.all([...host.querySelectorAll('img')].map(im => (im.complete ? 0 : new Promise(r => { im.onload = im.onerror = r; }))));
      const cv = await window.html2canvas(host.firstElementChild, { scale: 2, backgroundColor: '#ffffff' });
      const pdf = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4' });
      const M = 8, W = 210 - M * 2, H = 297 - M * 2, imgH = cv.height * W / cv.width;
      if (imgH <= H * 1.3) { // 稍微超過一頁：等比縮小放進一頁
        const k = Math.min(1, H / imgH);
        pdf.addImage(cv.toDataURL('image/jpeg', 0.92), 'JPEG', M + (W - W * k) / 2, M, W * k, imgH * k);
      } else {
        const pagePx = Math.floor(H * cv.width / W);
        for (let y = 0, first = true; y < cv.height; y += pagePx, first = false) {
          const part = document.createElement('canvas');
          part.width = cv.width; part.height = Math.min(pagePx, cv.height - y);
          part.getContext('2d').drawImage(cv, 0, -y);
          if (!first) pdf.addPage();
          pdf.addImage(part.toDataURL('image/jpeg', 0.92), 'JPEG', M, M, W, part.height * W / cv.width);
        }
      }
      return new File([pdf.output('blob')], `${(o.title || 'SOP').replace(/[\\/:*?"<>|]/g, '_')}_${dateStr()}.pdf`, { type: 'application/pdf' });
    } finally { host.remove(); }
  }


  // ---------------------------------------------------------------- 盤點訂貨
  // 依紙本「盤點／訂貨」週表：每個品項、每天各一格盤點量與訂貨量。
  // db.inv = { items: [{id,name,unit}], itemsAt, weeks: { 週一日期: { 品項id: { at, a: [一盤,一訂,二盤,二訂…日訂] } } } }
  // 同步時品項清單整份以較新的為準；每週每個品項一列各自以較新的為準（兩台同時填不同品項不會互蓋）
  const INV_DAYS = ['一', '二', '三', '四', '五', '六', '日'];
  const INV_DEFAULT = '紫洋蔥 斤|紅辣椒 斤|粗蒜碎 斤|九層塔 斤|大蒜仁 斤|中薑 斤|牛奶小黃瓜 斤|白蘿蔔 斤|空心菜 斤|南部蔥 公斤|進口洋蔥 斤|杏包菇 斤|鮮香菇 斤|牛蕃茄 斤|青江菜 斤|絲瓜 斤|南瓜-木瓜形 斤|高麗菜 斤|紅蘿蔔 斤|蒜片 斤|豆芽菜 斤|細蒜泥 斤';
  function normInv(v) {
    v = v && typeof v === 'object' ? v : {};
    const has = Array.isArray(v.items);
    // 預設品項用固定 id，各裝置還沒改過清單時填的資料才對得起來
    const items = has ? v.items.map(x => ({ id: String(x.id || uid()), name: String(x.name || ''), unit: String(x.unit || ''), code: String(x.code || ''), spec: String(x.spec || ''), price: String(x.price == null ? '' : x.price), off: !!x.off, stop: !!x.stop }))
      : INV_DEFAULT.split('|').map((l, i) => { const [name, unit] = l.split(' '); return { id: 'inv' + (i + 1), name, unit, code: '', spec: '', price: '', off: false, stop: false }; });
    const weeks = {};
    if (v.weeks && typeof v.weeks === 'object') for (const [k, w] of Object.entries(v.weeks)) {
      if (!/^\d{4}-\d\d-\d\d$/.test(k) || !w || typeof w !== 'object') continue;
      const o = {};
      for (const [id, r] of Object.entries(w)) if (r && Array.isArray(r.a)) o[id] = { at: +r.at || 0, a: Array.from({ length: 14 }, (_, i) => String(r.a[i] == null ? '' : r.a[i])) };
      weeks[k] = o;
    }
    const allNames = v.allNames && typeof v.allNames === 'object' ? { ...v.allNames } : {};
    const allCodes = v.allCodes && typeof v.allCodes === 'object' ? { ...v.allCodes } : {};
    return { items, itemsAt: has ? +v.itemsAt || 0 : 0, weeks, allNames, allCodes };
  }
  function mergeInv(a, b) {
    const weeks = {};
    for (const src of [b, a]) for (const [k, w] of Object.entries(src.weeks)) {
      const o = weeks[k] || (weeks[k] = {});
      for (const [id, r] of Object.entries(w)) if (!o[id] || r.at >= o[id].at) o[id] = r;
    }
    const items = a.itemsAt >= b.itemsAt ? a : b;
    return { items: items.items, itemsAt: items.itemsAt, weeks, allNames: { ...b.allNames, ...a.allNames }, allCodes: { ...b.allCodes, ...a.allCodes } };
  }

  const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const weekOf = d => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - (x.getDay() + 6) % 7); return ymd(x); };
  const invDate = (wk, i) => { const [y, m, d] = wk.split('-').map(Number); return new Date(y, m - 1, d + i); };
  const mdOf = d => `${d.getMonth() + 1}/${d.getDate()}`;
  let invWeek = weekOf(new Date());
  let invDay = (() => { try { const v = localStorage.getItem('ksop.invDay'); if (v != null) return +v; } catch (e) { /* 無法存取 */ } return IS_MOBILE ? -2 : -1; })(); // -1 整週、-2 今天、0~6
  const invDayNow = () => (invDay === -2 ? (invWeek === weekOf(new Date()) ? (new Date().getDay() + 6) % 7 : 0) : invDay);
  const invRow = (wk, id) => ((db.inv.weeks[wk] || {})[id] || { a: [] }).a;

  function viewInv() {
    const today = new Date(), thisWeek = weekOf(today), td = invWeek === thisWeek ? (today.getDay() + 6) % 7 : -1;
    const day = invDayNow(), days = day < 0 ? [0, 1, 2, 3, 4, 5, 6] : [day];
    const items = db.inv.items.filter(invOn);
    const head = days.map(i => `<th colspan="2" class="${i === td ? 'today' : ''}">星期${INV_DAYS[i]}<small>${mdOf(invDate(invWeek, i))}</small></th>`).join('');
    const sub = days.map(i => `<th class="${i === td ? 'today' : ''}">盤點</th><th class="${i === td ? 'today' : ''}">訂貨</th>`).join('');
    const rows = items.map(x => {
      const a = invRow(invWeek, x.id);
      return `<tr><th class="nm">${esc(x.name)}</th><td class="code"><input data-inv="${esc(x.id)}.c" value="${esc(x.code)}" autocomplete="off" placeholder="—" aria-label="${esc(x.name)} 品號"></td><td class="u">${esc(x.unit)}</td>${days.map(i => [0, 1].map(j =>
        `<td class="${i === td ? 'today' : ''} ${j ? 'ord' : ''}"><input data-inv="${esc(x.id)}.${i * 2 + j}" value="${esc(a[i * 2 + j] || '')}" inputmode="decimal" autocomplete="off" aria-label="${esc(x.name)} 星期${INV_DAYS[i]}${j ? '訂貨' : '盤點'}"></td>`).join('')).join('')}</tr>`;
    }).join('');
    return `<div class="page inv-page">
      <div class="page-head no-print"><h1 class="head-title">盤點訂貨</h1><div class="spacer"></div>
        ${day >= 0 ? '<button class="btn" data-act="inv-copy">📋 複製訂貨單</button>' : ''}
        <button class="btn" data-act="inv-items">✏️ 編輯品項</button>
        <button class="btn" data-act="inv-print">🖨 列印</button></div>
      <div class="inv-bar no-print">
        <button class="btn" data-act="inv-week" data-d="-1" title="上一週">‹</button>
        <b>${mdOf(invDate(invWeek, 0))}（一）～ ${mdOf(invDate(invWeek, 6))}（日）</b>
        <button class="btn" data-act="inv-week" data-d="1" title="下一週">›</button>
        ${invWeek !== thisWeek ? '<button class="btn ghost" data-act="inv-week" data-d="0">回本週</button>' : ''}
      </div>
      <div class="chips no-print">${[[-2, '今天'], [-1, '整週'], ...INV_DAYS.map((d, i) => [i, d])].map(([v, l]) => `<button class="chip ${invDay === v ? 'on' : ''}" data-act="inv-day" data-v="${v}">${l}</button>`).join('')}</div>
      ${items.length ? `<div class="inv-wrap no-print"><table class="inv-table ${day < 0 ? 'week' : 'one'}">
        <thead><tr><th rowspan="2" class="nm">材料名稱</th><th rowspan="2" class="code">品號</th><th rowspan="2" class="u">單位</th>${head}</tr><tr>${sub}</tr></thead>
        <tbody>${rows}</tbody></table></div>
        <p class="hint no-print">輸入後自動儲存；按 Enter 跳到下一個品項。</p>`
        : '<div class="empty no-print"><p>還沒有品項。</p><button class="btn primary" data-act="inv-items">＋ 加入品項</button></div>'}
      <div class="print-only" id="invPrint"></div>
    </div>`;
  }

  function invSet(id, k, v) {
    const w = db.inv.weeks[invWeek] || (db.inv.weeks[invWeek] = {});
    const r = w[id] || (w[id] = { at: 0, a: Array(14).fill('') });
    r.a[k] = v.trim(); r.at = Date.now();
    persist();
  }

  /** 列印用：仿紙本週表（A4 橫向） */
  function invPrintHtml(wk) {
    const a = id => invRow(wk, id);
    return `<div class="inv-print"><div class="ip-title">盤點訂貨表　${invDate(wk, 0).getFullYear()}/${mdOf(invDate(wk, 0))} ～ ${mdOf(invDate(wk, 6))}</div>
      <table><thead><tr><th rowspan="2" class="nm">材料名稱</th><th rowspan="2">品號</th><th rowspan="2" class="u">單位</th>${INV_DAYS.map((d, i) => `<th colspan="2">星期${d} ${mdOf(invDate(wk, i))}</th>`).join('')}</tr>
        <tr>${INV_DAYS.map(() => '<th>盤點</th><th>訂貨</th>').join('')}</tr></thead>
      <tbody>${db.inv.items.filter(invOn).map(x => `<tr><th class="nm">${esc(x.name)}</th><td>${esc(x.code)}</td><td>${esc(x.unit)}</td>${Array.from({ length: 14 }, (_, k) => `<td>${esc(a(x.id)[k] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  async function buildInvPdf(wk) {
    await Promise.all(PDF_LIBS.map(loadJs));
    const host = document.createElement('div');
    host.className = 'pdf-render';
    host.style.cssText = 'position:fixed;left:-10000px;top:0;width:1100px';
    host.innerHTML = invPrintHtml(wk);
    document.body.appendChild(host);
    try {
      const cv = await window.html2canvas(host.firstElementChild, { scale: 2, backgroundColor: '#ffffff' });
      const pdf = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
      const M = 8, W = 297 - M * 2, H = 210 - M * 2, imgH = cv.height * W / cv.width, k = Math.min(1, H / imgH);
      pdf.addImage(cv.toDataURL('image/jpeg', 0.92), 'JPEG', M + (W - W * k) / 2, M, W * k, imgH * k);
      return new File([pdf.output('blob')], `盤點訂貨_${wk}.pdf`, { type: 'application/pdf' });
    } finally { host.remove(); }
  }

  /** 某一天的訂貨單文字（傳 LINE 給廠商用） */
  function invOrderText(wk, i) {
    const a = id => invRow(wk, id);
    const lines = db.inv.items.filter(x => invOn(x) && (a(x.id)[i * 2 + 1] || '').trim()).map(x => `${x.code ? x.code + ' ' : ''}${x.name} ${a(x.id)[i * 2 + 1]}${/^[\d.\/\s]+$/.test(a(x.id)[i * 2 + 1]) ? ' ' + x.unit : ''}`);
    return lines.length ? `${mdOf(invDate(wk, i))}（${INV_DAYS[i]}）訂貨\n${lines.join('\n')}` : '';
  }

  // 盤點表高度跟著畫面：底部切齊視窗（手機扣掉下方導覽列），不會跟整頁捲動打架
  function fitInv() {
    const w = $('.inv-wrap'), t = $('.tabs');
    if (!w) return;
    const nav = getComputedStyle(t).position === 'fixed' ? t.offsetHeight : 0;
    w.style.maxHeight = Math.max(240, window.innerHeight - (w.getBoundingClientRect().top + window.scrollY) - nav - 16) + 'px';
  }
  window.addEventListener('resize', fitInv);

  // 品項編輯：仿叫貨系統的表格（# 品號 品名 規格 單位名稱 單價 暫不供貨 已停用）；可從 Excel／叫貨系統複製多列貼上
  const invOn = x => !x.off && !x.stop;
  const INV_COLS = [['code', '品號', 'w-code'], ['name', '品名', 'w-name'], ['spec', '規格', 'w-spec'], ['unit', '單位名稱', 'w-unit'], ['price', '單價', 'w-price']];
  function invEdRow(x, k) {
    return `<tr data-id="${esc(x.id || '')}"${x.stop ? ' class="stopped" hidden' : ''}><td class="no">${k + 1}</td>
      ${INV_COLS.map(([f, , c]) => `<td class="${c}"><input data-f="${f}" value="${esc(x[f] || '')}" autocomplete="off"${f === 'price' ? ' inputmode="decimal"' : ''}${f === 'name' || f === 'unit' ? '' : ' data-ime="en"'}></td>`).join('')}
      <td class="w-off"><input type="checkbox" data-f="off" ${x.off ? 'checked' : ''} aria-label="暫不供貨"></td>
      <td class="w-off"><input type="checkbox" data-f="stop" ${x.stop ? 'checked' : ''} aria-label="已停用"></td>
      <td class="w-act"><button class="icon" data-ed="up" title="上移">▲</button><button class="icon" data-ed="down" title="下移">▼</button><button class="icon" data-ed="rm" title="刪除">✕</button></td></tr>`;
  }
  async function invEditItems() {
    const pr = modal({
      title: '編輯盤點品項',
      body: `<p class="small muted">可直接從叫貨系統或 Excel 選取多列複製，點一格後貼上（Ctrl+V）會依欄位順序填入。勾「暫不供貨」或「已停用」的品項不會出現在盤點表；已停用的品項平常收起來，要改回來時勾「顯示已停用的品項」。刪除的品項已填的數字會保留，加回同名品項就會再出現。</p>
        <div class="inv-ed-wrap"><table class="inv-ed"><thead><tr><th>#</th>${INV_COLS.map(([, l, c]) => `<th class="${c}">${l}</th>`).join('')}<th class="w-off">暫不供貨</th><th class="w-off">已停用</th><th></th></tr></thead>
        <tbody id="invEd">${db.inv.items.map(invEdRow).join('')}</tbody></table></div>
        <div class="inv-ed-foot"><button class="btn" data-ed="add">＋ 新增品項</button>
        <label class="ck-lbl"><input type="checkbox" id="invEdStop"> 顯示已停用的品項（<span id="invEdStopN">0</span>）</label></div>`,
      buttons: [{ label: '取消', value: null }, { label: '儲存', cls: 'primary', value: m => [...m.querySelectorAll('#invEd tr')].map(tr => {
        const o = { id: tr.dataset.id };
        tr.querySelectorAll('[data-f]').forEach(i => { o[i.dataset.f] = i.type === 'checkbox' ? i.checked : i.value.trim(); });
        return o;
      }) }],
    });
    const box = $('#modal'), tb = $('#invEd');
    box.querySelector('.modal').classList.add('inv-ed-modal');
    const renum = () => [...tb.rows].forEach((tr, k) => { tr.cells[0].textContent = k + 1; });
    const addRow = () => { tb.insertAdjacentHTML('beforeend', invEdRow({}, tb.rows.length)); return tb.rows[tb.rows.length - 1]; };
    // 上一列／下一列都跳過收起來的已停用品項
    const sib = (tr, d) => { let x = tr; do { x = d > 0 ? x.nextElementSibling : x.previousElementSibling; } while (x && x.hidden); return x; };
    const isStop = tr => tr.querySelector('[data-f="stop"]').checked;
    const showStop = () => {
      const on = $('#invEdStop').checked;
      [...tb.rows].forEach(tr => { tr.hidden = !on && isStop(tr); });
    };
    const countStop = () => { $('#invEdStopN').textContent = [...tb.rows].filter(isStop).length; };
    countStop();
    $('#invEdStop').addEventListener('change', showStop);
    // 剛勾的先留在畫面上變灰，避免列一下子不見；下次打開才收起來
    tb.addEventListener('change', e => {
      if (e.target.dataset.f !== 'stop') return;
      e.target.closest('tr').classList.toggle('stopped', e.target.checked);
      countStop();
    });
    box.querySelector('.modal-body').addEventListener('click', e => {
      const b = e.target.closest('[data-ed]');
      if (!b) return;
      const tr = b.closest('tr');
      if (b.dataset.ed === 'add') { const r = addRow(); r.querySelector('[data-f="code"]').focus(); r.scrollIntoView({ block: 'nearest' }); }
      else if (b.dataset.ed === 'rm') tr.remove();
      else if (b.dataset.ed === 'up' && sib(tr, -1)) tr.parentNode.insertBefore(tr, sib(tr, -1));
      else if (b.dataset.ed === 'down' && sib(tr, 1)) tr.parentNode.insertBefore(sib(tr, 1), tr);
      renum(); countStop();
    });
    // Enter／↑↓：同一欄上下移動；最後一列按 Enter 新增一列
    tb.addEventListener('keydown', e => {
      const t = e.target;
      if (!t.dataset.f || t.type === 'checkbox' || e.isComposing || e.keyCode === 229) return;
      const d = e.key === 'Enter' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
      if (!d) return;
      e.preventDefault(); e.stopPropagation();
      const tr = t.closest('tr');
      let nx = sib(tr, d);
      if (!nx && d > 0 && e.key === 'Enter') { nx = addRow(); renum(); }
      if (nx) { const i = nx.querySelector(`[data-f="${t.dataset.f}"]`); i.focus(); i.select(); }
    });
    // 貼上多欄／多列（Tab、換行分隔）
    tb.addEventListener('paste', e => {
      const t = e.target, txt = (e.clipboardData || window.clipboardData).getData('text');
      if (!t.dataset.f || !/[\t\n]/.test(txt.trim())) return;
      e.preventDefault();
      const fields = INV_COLS.map(c => c[0]);
      let tr = t.closest('tr');
      const c0 = Math.max(0, fields.indexOf(t.dataset.f));
      txt.replace(/\r/g, '').split('\n').filter(l => l.trim()).forEach(line => {
        if (!tr) tr = addRow();
        line.split('\t').forEach((v, j) => { const f = fields[c0 + j], i = f && tr.querySelector(`[data-f="${f}"]`); if (i) i.value = v.trim(); });
        tr = sib(tr, 1);
      });
      renum();
    });
    const rows = await pr;
    if (rows == null) return;
    // 以前刪掉的品項：用名稱找回原本的 id，資料才接得回來
    const old = { ...db.inv.allNames };
    db.inv.items.forEach(x => { old[normName(x.name)] = x.id; });
    const seen = new Set(), items = [];
    for (const r of rows) {
      const name = (r.name || '').replace(/\s+/g, ' ');
      if (!name) continue;
      const key = normName(name);
      if (seen.has(key)) continue;
      seen.add(key);
      const prevCode = (db.inv.allCodes || {})[key];
      items.push({ id: r.id || old[key] || uid(), name, code: r.code || (r.id ? '' : prevCode || ''), spec: r.spec, unit: r.unit, price: r.price, off: !!r.off, stop: !!r.stop });
    }
    db.inv.allCodes = { ...db.inv.allCodes };
    db.inv.items.concat(items).forEach(x => { if (x.code) db.inv.allCodes[normName(x.name)] = x.code; });
    db.inv.allNames = old;
    items.forEach(x => { db.inv.allNames[normName(x.name)] = x.id; });
    db.inv.items = items; db.inv.itemsAt = Date.now();
    persist(); render(); toast(`已更新，共 ${items.length} 個品項`);
  }

  // ---- 照片辨識：照片 → Google 雲端硬碟 OCR（後端 a:'ocr'）→ 文字 → 解析成 SOP 欄位，確認後填入
  const OCR_UNITS = '公克|公斤|台斤|毫升|公升|kg|ml|cc|克|斤|兩|g|L|個|顆|片|包|條|根|把|罐|瓶|盒|隻|尾|瓣|粒|張|份|支|塊|袋|桶|箱';
  const OCR_UNIT_RE = new RegExp('^(' + OCR_UNITS + ')$', 'i');
  const OCR_HEAD_RE = /食材明細|使用份量|廠商|品牌|規格|進價|採購份量|總製|成量|耗損|損耗|未稅|含稅|成本|考核|補考|通過|時間|^NO$|^[(（][^)）]*[)）]$/i;
  const fixUnit = u => (/^g$/i.test(u) || u === '克' ? '公克' : /^kg$/i.test(u) ? '公斤' : u);
  const ocrHalf = t => String(t).replace(/[！-～]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/　/g, ' ');
  const ocrNum = t => /^\d+(\.\d+)?$/.test(String(t || '').replace(/,/g, ''));

  function parseOcrLine(line) {
    const str = ocrHalf(line).replace(/[|｜]/g, ' ').replace(/(\d)\s*%/g, '$1% ')
      .replace(new RegExp('(\\d)\\s*(' + OCR_UNITS + ')(?![A-Za-z])', 'gi'), '$1 $2 ').replace(/\s+/g, ' ').trim();
    const tk = str.split(' ').filter(Boolean);
    let i = 0;
    if (/^\d{1,2}$/.test(tk[0]) && tk[1] && !ocrNum(tk[1])) i = 1; // 最前面的 NO
    const name = [];
    while (i < tk.length && !ocrNum(tk[i])) name.push(tk[i++]);
    const nm = name.join(' ').trim();
    if (!nm || i >= tk.length || !/[\u3400-\u9fffA-Za-z]/.test(nm) || OCR_HEAD_RE.test(nm)) return null;
    const row = { name: nm, qty: tk[i++].replace(/,/g, ''), unit: '', vendor: '', specQty: '', specUnit: '', price: '', loss: '', buy: '' };
    if (OCR_UNIT_RE.test(tk[i] || '')) row.unit = tk[i++];
    const vendor = [];
    while (i < tk.length && !ocrNum(tk[i]) && !/%$/.test(tk[i])) vendor.push(tk[i++]);
    row.vendor = vendor.join(' ');
    // 剩下的數字：第一個帶單位的是規格，第一個不帶單位的是進價，帶 % 的是耗損（採購份量會自動算，不用讀）
    for (let j = i; j < tk.length; j++) {
      const t = tk[j];
      if (/^\d+(\.\d+)?%$/.test(t)) { row.loss = t.slice(0, -1); continue; }
      if (!ocrNum(t)) continue;
      const u = OCR_UNIT_RE.test(tk[j + 1] || '') ? tk[++j] : '';
      if (u && /\.\d\d$/.test(t)) { row.buy = t.replace(/,/g, ''); continue; }   // 採購份量：拿來核對
      if (u && !row.specQty) { row.specQty = t.replace(/,/g, ''); row.specUnit = u; }
      else if (!u && !row.price && !row.specQty) row.price = t.replace(/,/g, '');
      else if (!u && !row.price && row.specQty && !/\.\d\d$/.test(t)) row.price = t.replace(/,/g, '');
    }
    row.unit = fixUnit(row.unit) || '公克'; row.specUnit = fixUnit(row.specUnit) || (row.specQty ? row.unit : '公克');
    return row;
  }

  // Google 的 OCR 常把表格「一欄一欄」、甚至打散順序讀出來。依欄位的特徵與出現順序重組：
  //  品名 → 依序排隊等「使用份量」；同一行「單位 廠商」的字是廠商；連在一起的「份份份」拆成單位；
  //  連號的小整數是列號 NO；所有品名都有份量之後的數字依序是「規格」→（進價）→「採購份量」；兩位小數是採購份量。
  function parseOcrStream(lines) {
    const UNIT_G = new RegExp(OCR_UNITS, 'gi');
    const toks = [];
    lines.forEach((raw, ln) => {
      const str = ocrHalf(raw).replace(/[|｜□口【】\[\]]/g, ' ').replace(/(\d)\s*%/g, '$1% ')
        .replace(new RegExp('(\\d)\\s*(' + OCR_UNITS + ')(?![A-Za-z])', 'gi'), '$1 $2 ');
      str.split(/\s+/).filter(Boolean).forEach((t, k) => {
        const us = /\d/.test(t) ? null : t.match(UNIT_G);
        if (us && us.length >= 2 && t.replace(UNIT_G, '').length <= 1) us.forEach(u => toks.push({ t: u, ln, k: 9 })); // 「份份份」
        else toks.push({ t, ln, k });
      });
    });
    const isUnit = t => OCR_UNIT_RE.test(t || '');
    const isName = t => !ocrNum(t) && !isUnit(t) && !/%$/.test(t) && /[\u3400-\u9fffA-Za-z]/.test(t) && !OCR_HEAD_RE.test(t);
    // 列號 NO：行首整數後面接品名；或單獨一行的整數，下一行是品名／是它的下一號；或 3 行以上連號
    const byLine = new Map();
    toks.forEach(x => { if (!byLine.has(x.ln)) byLine.set(x.ln, []); byLine.get(x.ln).push(x); });
    const lns = [...byLine.keys()];
    const solo = ln => { const a = byLine.get(ln); return a && a.length === 1 && /^\d+$/.test(a[0].t) && +a[0].t <= 60 ? +a[0].t : null; };
    const nameFirst = ln => { const a = byLine.get(ln) || []; return a.length > 0 && isName(a[0].t); };      // 這行以品名開頭
    const noName = (ln, v) => { const a = byLine.get(ln) || []; return a.length > 1 && /^\d+$/.test(a[0].t) && +a[0].t === v && isName(a[1].t); }; // 「v 品名」
    lns.forEach(ln => { const a = byLine.get(ln); if (/^\d+$/.test(a[0].t) && +a[0].t <= 60 && a[1] && isName(a[1].t)) a[0].no = true; });
    for (let j = lns.length - 1; j >= 0; j--) {      // 由下往上，才能沿著「3 → 4 → 品名」這種連號判斷
      const a = byLine.get(lns[j]), v = solo(lns[j]);
      if (v == null) continue;
      const nx = byLine.get(lns[j + 1]);
      if (nameFirst(lns[j + 1]) || noName(lns[j + 1], v + 1) || (solo(lns[j + 1]) === v + 1 && nx[0].no)) a[0].no = true;
      let run = 1;
      for (let d = 1; solo(lns[j - d]) === v - d; d++) run++;
      for (let d = 1; solo(lns[j + d]) === v + d; d++) run++;
      if (run >= 3) a[0].no = true;
    }

    const items = [], pend = [], unitQ = [], vendQ = [], trail = [], specUnitQ = [], buys = [], losses = [];
    let last = '';
    for (let i = 0; i < toks.length; i++) {
      const x = toks[i], t = x.t, prev = toks[i - 1];
      if (x.no) continue;
      if (/^\d+(\.\d+)?%$/.test(t)) { losses.push(t.slice(0, -1)); continue; }
      if (ocrNum(t)) {
        const n = t.replace(/,/g, ''), nx = toks[i + 1], nx2 = toks[i + 2];
        // 下一個是單位就配成「數量＋單位」；但換行後是「單位 廠商」那一欄，就不是這個數量的單位
        const u = nx && isUnit(nx.t) && !(nx.ln !== x.ln && nx2 && nx2.ln === nx.ln && isName(nx2.t)) ? nx.t : '';
        if (u) i++;
        if (/\.\d\d$/.test(n)) { buys.push(n); last = 'buy'; continue; }          // 採購份量
        if (!items.length) continue;                                             // 第一個品名之前的數字
        if (pend.length) { const it = pend.shift(); it.qty = n; if (u) it.unit = u; last = 'qty'; x.owner = it; if (u) toks[i].owner = it; continue; }
        trail.push({ n, u }); last = 'trail'; continue;
      }
      if (isUnit(t)) {
        if (last === 'trail') specUnitQ.push(t); else if (last !== 'buy') unitQ.push(t);
        continue;
      }
      if (!isName(t)) continue;
      if (prev && isUnit(prev.t) && prev.ln === x.ln) {                           // 同一行「單位 廠商」
        if (prev.owner && !prev.owner.vendor) prev.owner.vendor = t; else vendQ.push(t);
        last = 'vendor'; continue;
      }
      const cur = items[items.length - 1];
      if (cur && !cur.qty && prev && prev.ln === x.ln && isName(prev.t) && !prev.no) { cur.name += ' ' + t; continue; } // 「M9 澳洲和牛…」
      const it = { name: t, qty: '', unit: '', vendor: '' };
      items.push(it); pend.push(it); last = 'name';
    }
    const rows = items.filter(it => it.qty);
    const N = rows.length;
    rows.forEach(it => { if (!it.unit && unitQ.length) it.unit = unitQ.shift(); });
    rows.forEach(it => { if (!it.vendor && vendQ.length) it.vendor = vendQ.shift(); });
    const common = (() => { const c = {}; rows.forEach(it => { if (it.unit) c[it.unit] = (c[it.unit] || 0) + 1; }); return Object.keys(c).sort((p2, q2) => c[q2] - c[p2])[0] || '公克'; })();
    trail.forEach(e => { if (!e.u && specUnitQ.length) e.u = specUnitQ.shift(); });
    const specs = trail.slice(0, N), rest = trail.slice(N).map(e => e.n);
    let prices = [];
    const need = Math.max(0, N - buys.length);
    if (rest.length >= N + need && need) { prices = rest.slice(0, N); buys.push(...rest.slice(N, N + need)); }
    else if (need && rest.length === need) buys.push(...rest);
    else if (rest.length >= N) prices = rest.slice(0, N);
    return rows.map((it, k) => {
      const unit = fixUnit(it.unit || common), sp = specs[k] || {};
      return { name: it.name, qty: it.qty, unit, vendor: it.vendor, specQty: sp.n || '', specUnit: fixUnit(sp.u || unit), price: prices[k] || '',
        loss: losses.length === N ? losses[k] : '', buy: buys.length === N ? buys[k] : '' };
    });
  }

  function parseOcrText(text) {
    const out = { title: '', rows: [], steps: [], notes: [] }, tableLines = [];
    let mode = 'table';
    for (const raw of String(text || '').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      if (/操作步驟/.test(line)) { mode = 'steps'; continue; }
      if (/注意事項/.test(line)) { mode = 'notes'; continue; }
      if (/^照片$/.test(line)) { mode = mode === 'steps' ? 'none' : mode; continue; }
      if (/成本合計|淨售價|含稅售價/.test(line)) { mode = 'none'; continue; }
      if (!out.title && /\d{4}[.\/-]\d{1,2}/.test(line) && !/考核|補考/.test(line) && line.length <= 40) { out.title = ocrHalf(line).replace(/\s+/g, ''); continue; }
      if (mode === 'table') { tableLines.push(line); const r = parseOcrLine(line); if (r) out.rows.push(r); }
      if (mode === 'table' && /^(NO|食材明細)$|食材明細/i.test(line) && !out.headAt) out.headAt = tableLines.length;
      else if (mode === 'steps' || mode === 'notes') {
        const t = line.replace(/^\d{1,2}[.、)\s]+/, '').trim();
        if (/[\u3400-\u9fff]/.test(t) && !/^\d+$/.test(t)) out[mode].push(t);
      }
    }
    // 一行一項的寫法用逐行解析；讀不出來（表格被拆成一欄一欄）就改用順序配對，取讀到較多項的
    const stream = parseOcrStream(out.headAt ? tableLines.slice(out.headAt) : tableLines);
    delete out.headAt;
    if (stream.length > out.rows.length) out.rows = stream;
    return out;
  }

  // ---- 自動檢查：用紙本的「採購份量」反算核對、品名／廠商對照既有資料校正錯字、可疑的格子標紅
  const ocrNorm = t => ocrHalf(t || '').replace(/[\s()（）\-－_.·,，]/g, '').toLowerCase();
  function lev(a, b) {
    const d = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      let prev = d[0]; d[0] = i;
      for (let j = 1; j <= b.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t; }
    }
    return d[b.length];
  }
  function bestMatch(text, list) {
    const n = ocrNorm(text);
    if (n.length < 2) return null;
    let best = null, bs = 0;
    for (const c of list) {
      const m = ocrNorm(c);
      if (!m) continue;
      if (m === n) return { v: c, exact: true };
      const sim = 1 - lev(n, m) / Math.max(n.length, m.length);
      if (sim > bs) { bs = sim; best = c; }
    }
    return best && bs >= 0.75 && Math.abs(ocrNorm(best).length - n.length) <= 2 ? { v: best, sim: bs } : null;
  }
  function ocrKnown(exceptId) {
    const names = new Set(), vendors = new Set();
    db.prices.forEach(x => x.name.trim() && names.add(x.name.trim()));
    db.recipes.forEach(r => r.ingredients.forEach(i => !isHead(i) && i.name.trim() && names.add(i.name.trim())));
    db.sops.forEach(o => o.id !== exceptId && o.rows.forEach(x => { if (x.name.trim()) names.add(x.name.trim()); if (x.vendor.trim()) vendors.add(x.vendor.trim()); }));
    return { names: [...names], vendors: [...vendors] };
  }
  const round2 = v => Math.round(v * 100) / 100;

  /** 檢查一列：fuzzy=true 時才做錯字校正（使用者自己改過的就不再動） */
  function ocrCheckRow(r, known, fuzzy, others) {
    r.notes = []; r.bad = []; r.status = '';
    if (fuzzy) {
      r.orig = { name: r.name, vendor: r.vendor };
      const mn = bestMatch(r.name, known.names);
      if (mn && !mn.exact) { r.name = mn.v; r.notes.push(`品名已對照既有資料校正（原：${r.orig.name}）`); r.fixed = true; }
      const mv = r.vendor && bestMatch(r.vendor, known.vendors);
      if (mv && !mv.exact) { r.vendor = mv.v; r.notes.push(`廠商已校正（原：${r.orig.vendor}）`); r.fixed = true; }
    }
    const open = (r.name.match(/[(（]/g) || []).length, close = (r.name.match(/[)）]/g) || []).length;
    if (open !== close) { r.bad.push('name'); r.notes.push('品名括號不完整，可能被截斷'); }
    if (!r.name.trim()) r.bad.push('name');
    const q = sopNum(r.qty), lossNum = r.loss === '' ? null : sopNum(r.loss), buy = sopNum(r.buy);
    if (r.qty !== '' && q == null) { r.bad.push('qty'); r.notes.push('使用份量不是數字'); }
    if (r.loss !== '' && lossNum == null) { r.bad.push('loss'); r.notes.push('耗損不是數字'); }
    if (q != null && lossNum == null && buy) {
      const l = round2((1 - q / buy) * 100);
      if (l >= 0 && l < 90) { r.loss = String(l); r.notes.push(`耗損由紙本採購份量 ${buy} 推算`); r.status = 'ok'; }
    } else if (q == null && lossNum != null && buy) {
      r.qty = String(round2(buy * (1 - lossNum / 100))); r.notes.push(`使用份量由紙本採購份量 ${buy} 推算，請確認`); r.status = 'warn'; r.bad.push('qty');
    } else if (q != null && lossNum != null && buy) {
      const exp = q / (1 - lossNum / 100);
      if (Math.abs(exp - buy) <= 0.02) { r.status = 'ok'; r.notes.push(`和紙本採購份量 ${buy} 核對相符`); }
      else { r.status = 'warn'; r.bad.push('qty', 'loss'); r.notes.push(`紙本採購份量 ${buy}，但 ${q}÷(1−${lossNum}%) = ${round2(exp)}，份量或耗損可能讀錯`); }
    } else if (q != null && !buy) r.notes.push('紙本沒有採購份量可核對');
    if (others.vendor && !r.vendor.trim()) { r.bad.push('vendor'); r.notes.push('廠商沒讀到'); }
    if (others.spec && !r.specQty) { r.bad.push('specQty'); r.notes.push('規格沒讀到'); }
    if (r.specQty && sopNum(r.specQty) == null) r.bad.push('specQty');
    if (r.price && sopNum(r.price) == null) r.bad.push('price');
    if (r.bad.length && r.status !== 'warn') r.status = 'warn';
    return r;
  }
  function ocrCheck(p, exceptId) {
    const known = ocrKnown(exceptId);
    const others = { vendor: p.rows.filter(x => x.vendor).length > p.rows.length / 2, spec: p.rows.filter(x => x.specQty).length > p.rows.length / 2 };
    p.rows.forEach(r => ocrCheckRow(r, known, true, others));
    p.known = known; p.others = others;
    return p;
  }

  function ocrRowHtml(x, k) {
    const cell = (f, cls = '', extra = '') => `<td><input class="${cls} ${x.bad.includes(f) ? 'bad' : ''}" data-ocr="${k}.${f}" value="${esc(x[f] || '')}" ${extra}></td>`;
    const icon = x.status === 'ok' ? '<span class="ok">✓</span>' : x.status === 'warn' ? '<span class="warn">⚠</span>' : '<span class="muted">–</span>';
    return `<tr id="ocrR${k}" class="${x.status}">
      <td class="no">${k + 1}</td>${cell('name', 'w-name')}${cell('qty', 'w-num', 'inputmode="decimal"')}${cell('unit', 'w-unit')}${cell('vendor', 'w-vendor')}
      ${cell('specQty', 'w-num', 'inputmode="decimal"')}${cell('specUnit', 'w-unit')}${cell('price', 'w-num', 'inputmode="decimal"')}${cell('loss', 'w-loss', 'inputmode="decimal"')}
      <td class="ocr-st">${icon}<div class="small">${x.notes.map(esc).join('<br>')}</div>${x.fixed ? `<button class="btn sm" data-ocr-undo="${k}">↩ 還原</button>` : ''}</td>
      <td><button class="icon danger" data-ocr-rm="${k}" title="不要這一列">✕</button></td></tr>`;
  }
  function ocrTableHtml(p) {
    const ok = p.rows.filter(x => x.status === 'ok').length, warn = p.rows.filter(x => x.status === 'warn').length;
    return `<div class="ocr-sum">${p.rows.length} 項食材：<span class="ok">✓ 已核對 ${ok}</span>　<span class="warn">⚠ 需確認 ${warn}</span>　<span class="muted">– 無法核對 ${p.rows.length - ok - warn}</span></div>
      <div class="sop-table-wrap"><table class="ocr-table"><thead><tr><th>NO</th><th>食材明細</th><th>使用份量</th><th>單位</th><th>廠商/品牌</th><th>規格</th><th>單位</th><th>進價</th><th>耗損%</th><th>檢查</th><th></th></tr></thead>
      <tbody>${p.rows.map(ocrRowHtml).join('') || '<tr><td colspan="11" class="muted">沒有辨識出食材列。可以展開下方原始文字，把每項食材整理成一行再按「重新判讀」。</td></tr>'}</tbody></table></div>`;
  }

  // ---- 從表單照片裡找出「照片」欄的圖片：找最下面那條橘色標題列，在它下方找一塊顏色豐富／偏暗的方塊
  // 回傳 { x, y, w, h }（原圖座標）或 null
  function findPhotoBox(bmp) {
    const W = 480, H = Math.round(bmp.height * W / bmp.width);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'); g.drawImage(bmp, 0, 0, W, H);
    const px = g.getImageData(0, 0, W, H).data;
    const hsv = i => {
      const r = px[i] / 255, gg = px[i + 1] / 255, b = px[i + 2] / 255, mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), d = mx - mn;
      let h = 0;
      if (d) h = mx === r ? ((gg - b) / d) % 6 : mx === gg ? (b - r) / d + 2 : (r - gg) / d + 4;
      return [(h * 60 + 360) % 360, mx ? d / mx : 0, mx];
    };
    const orange = new Uint8Array(W * H), photo = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const [h, sat, v] = hsv((y * W + x) * 4);
      if (h >= 22 && h <= 55 && sat > 0.45 && v > 0.45) orange[y * W + x] = 1;
      else if (v < 0.45 || (sat > 0.3 && !(h >= 25 && h <= 60))) photo[y * W + x] = 1;   // 偏暗或有顏色（排除紙張的黃光）
    }
    // 橘色標題列：一整列有 30% 以上是橘色
    const bands = [];
    for (let y = 0; y < H; y++) {
      let n = 0, x0 = W, x1 = 0;
      for (let x = 0; x < W; x++) if (orange[y * W + x]) { n++; if (x < x0) x0 = x; x1 = x; }
      if (n > W * 0.3) { const bd = bands[bands.length - 1]; if (bd && y - bd.y1 <= 2) { bd.y1 = y; bd.x0 = Math.min(bd.x0, x0); bd.x1 = Math.max(bd.x1, x1); } else bands.push({ y0: y, y1: y, x0, x1 }); }
    }
    const band = bands.filter(b => b.y0 < H * 0.95 && b.y0 > H * 0.4).pop();
    if (!band) return null;
    // 在橘色列下方、頁面範圍內，用 6×6 的格子找「大多是照片像素」的區塊
    const CS = 6, gx0 = band.x0, gy0 = band.y1 + 2, gw = Math.floor((band.x1 - gx0) / CS), gh = Math.floor((H - gy0) / CS);
    if (gw < 4 || gh < 4) return null;
    const cell = new Uint8Array(gw * gh);
    for (let cy = 0; cy < gh; cy++) for (let cx = 0; cx < gw; cx++) {
      let n = 0;
      for (let y = 0; y < CS; y++) for (let x = 0; x < CS; x++) n += photo[(gy0 + cy * CS + y) * W + gx0 + cx * CS + x];
      cell[cy * gw + cx] = n > CS * CS * 0.45 ? 1 : 0;
    }
    // 最大的連通區塊
    const seen = new Uint8Array(gw * gh);
    let best = null;
    for (let i = 0; i < gw * gh; i++) {
      if (!cell[i] || seen[i]) continue;
      const st = [i]; seen[i] = 1;
      let n = 0, mx0 = gw, my0 = gh, mx1 = 0, my1 = 0;
      while (st.length) {
        const j = st.pop(), x = j % gw, y = (j - x) / gw;
        n++; mx0 = Math.min(mx0, x); my0 = Math.min(my0, y); mx1 = Math.max(mx1, x); my1 = Math.max(my1, y);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy, k = ny * gw + nx;
          if (nx >= 0 && ny >= 0 && nx < gw && ny < gh && cell[k] && !seen[k]) { seen[k] = 1; st.push(k); }
        }
      }
      // 橫跨大半頁寬的是頁面外的東西（桌面、看圖軟體的黑邊），照片欄只在左側
      if (mx1 - mx0 + 1 > gw * 0.75) continue;
      if (!best || n > best.n) best = { n, mx0, my0, mx1, my1 };
    }
    if (!best) return null;
    const bw = best.mx1 - best.mx0 + 1, bh = best.my1 - best.my0 + 1;
    // 太小、太細長、或不夠「實心」就不是照片
    if (best.n < 40 || bw < 6 || bh < 6 || best.n < bw * bh * 0.5 || bw / bh > 4 || bh / bw > 4) return null;
    const k = bmp.width / W;
    return { x: Math.round((gx0 + best.mx0 * CS) * k), y: Math.round((gy0 + best.my0 * CS) * k), w: Math.round(bw * CS * k), h: Math.round(bh * CS * k) };
  }

  /** 表單上有貼照片：裁下來（長邊 800px）給「照片」欄用；沒有就回傳 '' */
  async function cropFormPhoto(file) {
    try {
      const bmp = await createImageBitmap(file);
      const r = findPhotoBox(bmp);
      if (!r) return '';
      const k = Math.min(1, 800 / Math.max(r.w, r.h)), c = document.createElement('canvas');
      c.width = Math.round(r.w * k); c.height = Math.round(r.h * k);
      c.getContext('2d').drawImage(bmp, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', 0.8);
    } catch (e) { return ''; }
  }

  async function sopOcr(o, file) {
    if (!db.cloud) return toast('照片辨識需要先在「設定」連線 Google 雲端', 'err');
    toast('照片辨識中…（約 10～30 秒）');
    let text, img, crop = '';
    try {
      img = await resizeImage(file, 2400);
      crop = await cropFormPhoto(file);
      const j = await cloudCall({ a: 'ocr', image: img.split(',')[1], mime: 'image/jpeg' });
      text = j.text || '';
    } catch (e) { return toast('照片辨識失敗：' + e.message, 'err'); }
    if (!text.trim()) return toast('照片裡沒有辨識出文字，請拍清楚一點再試', 'err');
    let parsed = ocrCheck(parseOcrText(text), o.id);
    const pending = modal({
      title: '照片辨識結果（請對照照片確認）',
      body: `<div class="ocr-layout">
          <div class="ocr-photo" title="點一下放大／縮小"><img src="${img}" alt="原始照片"></div>
          <div class="ocr-main">
            <p class="hint">✓ 表示已用紙本的「採購份量」反算核對相符；⚠ 和紅框是需要確認的格子。可以直接在表格裡修改，品名、廠商會先對照單價表、食譜和其他 SOP 自動校正錯字。</p>
            <label class="fld">品項名稱<input id="ocrTitle" value="${esc(parsed.title)}" placeholder="（沒讀到，保留原本的）"></label>
            <div id="ocrTable">${ocrTableHtml(parsed)}</div>
            ${crop ? `<div class="ocr-crop"><img src="${crop}" alt="表單上的照片">
              <label class="ck-lbl"><input type="checkbox" id="ocrUsePhoto" ${o.photo ? '' : 'checked'}> 把表單上的這張照片放進「照片」欄${o.photo ? '（會取代目前的照片）' : ''}</label></div>` : ''}
            ${parsed.steps.length || parsed.notes.length ? `<p class="small muted">另外讀到操作步驟 ${parsed.steps.length} 行、注意事項 ${parsed.notes.length} 行，會一起填入。</p>` : ''}
            <details class="ocr-raw"><summary>辨識出的原始文字</summary>
              <textarea id="ocrText" rows="12" spellcheck="false">${esc(text)}</textarea>
              <button class="btn sm" id="ocrReparse">重新判讀（會取代上面表格）</button></details>
          </div></div>`,
      buttons: [{ label: '取消', value: null }, { label: '填入', cls: 'primary', value: m => { const u = m.querySelector('#ocrUsePhoto'); parsed.photo = u && u.checked ? crop : ''; return parsed; } }],
    });
    const md = $('#modal .modal');
    if (md) {
      md.classList.add('ocr-modal');
      const redraw = () => { $('#ocrTable').innerHTML = ocrTableHtml(parsed); };
      md.addEventListener('input', e => {
        const t = e.target;
        if (t.id === 'ocrTitle') { parsed.title = t.value; return; }
        if (!t.dataset.ocr) return;
        const [k, f] = t.dataset.ocr.split('.'), r = parsed.rows[+k];
        r[f] = t.value;
        ocrCheckRow(r, parsed.known, false, parsed.others);    // 只重新核對，不再改使用者打的字
        const tr = $('#ocrR' + k), st = tr && tr.querySelector('.ocr-st');
        if (tr) { tr.className = r.status; tr.querySelectorAll('[data-ocr]').forEach(el => el.classList.toggle('bad', r.bad.includes(el.dataset.ocr.split('.')[1]))); }
        if (st) st.innerHTML = (r.status === 'ok' ? '<span class="ok">✓</span>' : r.status === 'warn' ? '<span class="warn">⚠</span>' : '<span class="muted">–</span>') + `<div class="small">${r.notes.map(esc).join('<br>')}</div>`;
      });
      md.addEventListener('click', e => {
        const t = e.target;
        if (t.closest('.ocr-photo')) { t.closest('.ocr-photo').classList.toggle('zoom'); return; }
        if (t.dataset.ocrRm != null) { parsed.rows.splice(+t.dataset.ocrRm, 1); redraw(); return; }
        if (t.dataset.ocrUndo != null) {
          const r = parsed.rows[+t.dataset.ocrUndo];
          Object.assign(r, r.orig); r.fixed = false; ocrCheckRow(r, parsed.known, false, parsed.others); redraw(); return;
        }
        if (t.id === 'ocrReparse') { const title = $('#ocrTitle').value; parsed = ocrCheck(parseOcrText($('#ocrText').value), o.id); if (!parsed.title) parsed.title = title; $('#ocrTitle').value = parsed.title; redraw(); }
      });
    }
    const res = await pending;
    if (!res) return;
    const cur = getSop(o.id);
    if (!cur) return;
    if (res.title && (!cur.title.trim() || cur.title === '未命名 SOP')) cur.title = res.title;
    if (res.photo) cur.photo = res.photo;
    cur.rows = cur.rows.filter(x => x.name.trim() || x.qty);
    for (const r of res.rows) {
      const x = normSopRow({ name: r.name, qty: r.qty, unit: r.unit, vendor: r.vendor, specQty: r.specQty, specUnit: r.specUnit, price: r.price, loss: r.loss });
      sopFillFromPrice(x); cur.rows.push(x);
    }
    if (res.steps.length) cur.steps = [cur.steps.trim(), res.steps.join('\n')].filter(Boolean).join('\n');
    if (res.notes.length) cur.notes = [cur.notes.trim(), res.notes.join('\n')].filter(Boolean).join('\n');
    sopTouch(cur);
    if (route.name === 'sop' && route.id === cur.id) render(); else location.hash = '#/sop/' + encodeURIComponent(cur.id);
    const warn = res.rows.filter(x => x.status === 'warn').length;
    toast(`已填入 ${res.rows.length} 項食材${warn ? `（${warn} 項請再確認）` : ''}`);
  }

  function sopTouch(o) { o.updatedAt = Date.now(); persist(); }
  function sopFillFromPrice(x) {
    if (x.specQty || x.price) return false;
    const p = priceMap().get(normName(x.name));
    if (!p) return false;
    x.specQty = fmt(p.perQty); x.specUnit = p.perUnit || x.specUnit; x.price = fmt(p.price);
    return true;
  }
  async function sopFromRecipe(o) {
    if (!db.recipes.length) return toast('還沒有食譜', 'err');
    const list = [...db.recipes].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
    const id = await modal({
      title: '從食譜帶入',
      body: `<p>把食譜的食材、步驟、備註帶進這份 SOP（加在現有內容後面）。</p><select id="sopRecipe">${list.map(r => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('')}</select>`,
      buttons: [{ label: '取消', value: null }, { label: '帶入', cls: 'primary', value: m => m.querySelector('#sopRecipe').value }],
    });
    const r = id && getRecipe(id);
    if (!r) return;
    o.rows = o.rows.filter(x => x.name.trim() || x.qty);
    for (const i of r.ingredients) {
      if (isHead(i) || !i.name.trim()) continue;
      const x = normSopRow({ name: i.name, qty: i.qty == null ? '' : fmt(i.qty), unit: i.unit || '公克', loss: '' });
      sopFillFromPrice(x);
      o.rows.push(x);
    }
    const st = r.steps.map(x => x.text.trim()).filter(Boolean).join('\n');
    if (st) o.steps = o.steps.trim() ? o.steps.trim() + '\n' + st : st;
    if (r.notes.trim()) o.notes = o.notes.trim() ? o.notes.trim() + '\n' + r.notes.trim() : r.notes.trim();
    if (!o.title.trim()) o.title = r.name;
    if (!o.photo && r.photo) o.photo = r.photo;
    sopTouch(o); render(); toast(`已帶入「${r.name}」`);
  }


  // ---------------------------------------------------------------- 快捷鍵
  // 多數快捷鍵直接「按」畫面上對應的按鈕，行為和用滑鼠點完全一樣。
  // 避開瀏覽器保留的鍵（Ctrl+N/T/W、Alt+F/E/D）；輸入法選字中不觸發。
  const clickEl = sel => { const el = $(sel); if (!el || el.disabled) return false; el.click(); return true; };
  const clickAct = act => clickEl(`#app [data-act="${act}"], #modal [data-act="${act}"]`);
  const go = h => { location.hash = h; return true; };
  function focusSearch() {
    const el = $('#q') || $('#pq') || $('#sopq');
    if (!el) { go('#/'); setTimeout(() => { const q = $('#q'); if (q) q.focus(); }, 50); return true; }
    el.focus(); el.select(); return true;
  }
  function stepMult(d) {
    if (route.name !== 'r') return false;
    const vals = MULT_CHIPS.map(c => c[0]), cur = vs(route.id).mult;
    let k = vals.findIndex(v => v >= cur - 1e-9);
    if (k < 0) k = vals.length - 1;
    if (d > 0) k = vals[k] > cur + 1e-9 ? k : Math.min(vals.length - 1, k + 1);
    else k = Math.max(0, (vals[k] < cur - 1e-9 ? k : k - 1));
    setMult(vals[k]);
    const mi = $('#mult'); if (mi) mi.value = multText(vs(route.id).mult);
    toast(`倍數 × ${multText(vs(route.id).mult)}`);
    return true;
  }
  function printPage() {
    if (route.name === 'cheat') return clickAct('cheat-print');
    if (route.name === 'sop') return clickAct('sop-print');
    if (route.name === 'inv') return clickAct('inv-print');
    if (route.name === 'labels') return clickAct('label-print') || clickAct('label-browser');
    if (/^(r|plan)$/.test(route.name)) { flush(); window.print(); return true; }
    return false;
  }
  function saveOrSync() {
    if (route.name === 'edit' || route.name === 'new') return clickAct('save-recipe');
    flush();
    if (db.cloud) { cloudSync(); toast('已儲存，正在同步'); } else toast('已儲存');
    return true;
  }
  function newItem() {
    switch (route.name) {
      case 'sops': case 'sop': return clickEl('#app [data-act="sop-new"]') || (go('#/sops'), setTimeout(() => clickAct('sop-new'), 50), true);
      case 'prices': return clickAct('price-add');
      case 'plan': { const s2 = $('#planAdd'); if (s2) { s2.focus(); return true; } return false; }
      case 'cheat': return clickAct('cheat-edit');
      case 'edit': case 'new': return clickAct('add');
      default: return go('#/new');
    }
  }

  // [按鍵, 說明, 適用頁面（空白＝全部）, 動作]
  const SHORTCUTS = [
    ['Alt+1', '切到「食譜」', '', () => go('#/')],
    ['Alt+2', '切到「SOP」', '', () => go('#/sops')],
    ['Alt+3', '切到「備料單」', '', () => go('#/plan')],
    ['Alt+4', '切到「小抄」', '', () => go('#/cheat')],
    ['Alt+5', '切到「標籤」', '', () => go('#/labels')],
    ['Alt+6', '切到「盤點訂貨」', '', () => go('#/inv')],
    ['Alt+7', '切到「設定」', '', () => go('#/settings')],
    ['Ctrl+F', '搜尋（食譜／SOP／單價表）', '', focusSearch],
    ['/', '搜尋（不在輸入框時）', '', focusSearch],
    ['Alt+N', '新增（依頁面：食譜、SOP、單價、備料單菜色、小抄卡片、編輯中的食材）', '', newItem],
    ['Ctrl+S', '儲存（編輯食譜時）／立即同步', '', saveOrSync],
    ['Ctrl+P', '列印（食譜、備料單、小抄、SOP）', '', printPage],
    ['Esc', '關閉視窗／取消編輯', '', () => (route.name === 'edit' || route.name === 'new' ? clickAct('cancel-edit') : false)],
    ['F1', '顯示快捷鍵說明', '', () => (showShortcuts(), true)],
    ['?', '顯示快捷鍵說明（不在輸入框時）', '', () => (showShortcuts(), true)],
    // 食譜頁
    ['Ctrl+E', '編輯這道食譜', 'r', () => clickEl(`#app a[href="#/edit/${encodeURIComponent(route.id)}"]`)],
    ['Ctrl+D', '複製', 'r', () => clickAct('dup')],
    ['Alt+P', '加入備料單', 'r', () => clickAct('addplan')],
    ['Alt+C', '加到小抄', 'r', () => clickAct('cheat-from-recipe')],
    ['Alt+M', '輸入倍數', 'r', () => { const m = $('#mult'); if (m) { m.focus(); m.select(); } return !!m; }],
    ['+', '倍數加一級（不在輸入框時）', 'r', () => stepMult(1)],
    ['-', '倍數減一級（不在輸入框時）', 'r', () => stepMult(-1)],
    ['Alt+U', '清除勾選', 'r', () => clickAct('uncheck')],
    ['Alt+W', '螢幕恆亮（手機）', 'r', () => clickAct('wake')],
    // 編輯食譜
    ['Ctrl+Enter', '儲存食譜', 'edit', () => clickAct('save-recipe')],
    ['Alt+I', '新增食材', 'edit', () => clickEl('#app [data-act="add"][data-list="ingredients"]')],
    ['Alt+H', '新增小標題', 'edit', () => clickAct('add-head')],
    ['Alt+T', '新增步驟', 'edit', () => clickEl('#app [data-act="add"][data-list="steps"]')],
    ['Alt+B', '批次貼上食材', 'edit', () => clickEl('#app [data-act="bulk"][data-list="ingredients"]')],
    ['Alt+V', '翻譯越南文', 'edit', () => clickAct('tr-draft')],
    // SOP
    ['Alt+R', '新增食材列', 'sop', () => clickAct('sop-row-add')],
    ['Alt+O', '照片辨識', 'sop', () => clickEl('#app [data-act-change="sop-ocr"]')],
    ['Alt+L', '從食譜帶入', 'sop', () => clickAct('sop-from-recipe')],
    ['Ctrl+D', '複製 SOP', 'sop', () => clickAct('sop-dup')],
    ['Alt+O', '從照片建立 SOP', 'sops', () => clickEl('#app [data-act-change="sop-ocr-new"]')],
    // 備料單、小抄、單價表、設定
    ['Alt+C', '做成小抄', 'plan', () => clickAct('cheat-from-plan')],
    ['Alt+K', '編輯小抄卡片', 'cheat', () => clickAct('cheat-edit')],
    ['Alt+I', '從食譜帶入食材', 'prices', () => clickAct('price-import')],
    ['Alt+X', '匯出備份', 'settings', () => clickAct('export')],
  ];
  const PAGE_NAMES = { '': '全部頁面', r: '食譜頁', edit: '編輯食譜', sop: 'SOP 表單', sops: 'SOP 列表', plan: '備料單', cheat: '小抄', prices: '單價表', labels: '標籤', inv: '盤點訂貨', settings: '設定' };

  function keyName(e) {
    const k = e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key;
    if (k === 'Escape') return 'Esc';
    const plain = ['/', '?', '+', '-', '='].includes(e.key);
    if (plain && !e.ctrlKey && !e.metaKey && !e.altKey) return e.key === '=' ? '+' : e.key;
    // Alt＋數字用實體鍵位，避免輸入法或鍵盤配置影響
    const code = /^Digit(\d)$/.exec(e.code || '');
    const base = code && e.altKey ? code[1] : /^Key([A-Z])$/.test(e.code || '') ? e.code.slice(3) : k;
    return (e.ctrlKey || e.metaKey ? 'Ctrl+' : '') + (e.altKey ? 'Alt+' : '') + (e.shiftKey && base.length > 1 ? 'Shift+' : '') + base;
  }
  // 盤點訂貨表：Enter／↓ 到下一個品項同一格，↑ 回上一個
  document.addEventListener('keydown', e => {
    const t = e.target;
    if (!t.dataset || !t.dataset.inv || e.isComposing || e.keyCode === 229 || e.altKey || e.ctrlKey) return;
    const d = e.key === 'Enter' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    const k = t.dataset.inv.split('.')[1], all = $$(`#app input[data-inv$=".${k}"]`), nx = all[all.indexOf(t) + (e.shiftKey && e.key === 'Enter' ? -1 : d)];
    e.preventDefault();
    if (nx) { nx.focus(); nx.select(); } else t.blur();
  });
  document.addEventListener('keydown', e => {
    if (e.defaultPrevented || e.isComposing || e.keyCode === 229 || e.repeat && !/^[+-]$/.test(e.key)) return; // 對話框已處理過的鍵不再觸發
    const name = keyName(e);
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target || {}).tagName || '') || (e.target && e.target.isContentEditable);
    if (typing && !/^(Ctrl|Alt|F\d|Esc)/.test(name)) return;   // 打字時只認組合鍵
    if ($('#modal.open')) return;                                // 對話框開著：交給對話框（Esc、Enter）
    const page = route.name === 'new' ? 'edit' : route.name === 'list' ? 'list' : route.name;
    const hit = SHORTCUTS.find(([k, , pg]) => k === name && pg === page) || SHORTCUTS.find(([k, , pg]) => k === name && !pg);
    if (!hit) return;
    if (hit[3]() !== false) e.preventDefault();
  });

  // ---- 貼上（Ctrl+V）或拖曳照片：依目前頁面決定用途
  async function useImage(file) {
    if (!file || !/^image\//.test(file.type)) return false;
    if (route.name === 'edit' || route.name === 'new') {
      if (!draft) return false;
      try { draft.r.photo = await resizeImage(file); draft.dirty = true; rerenderEdit(); toast('已貼上食譜照片'); } catch (e) { toast(e.message, 'err'); }
      return true;
    }
    if (route.name === 'sops') { const o = normSop({}); db.sops.push(o); persist(); location.hash = '#/sop/' + encodeURIComponent(o.id); sopOcr(o, file); return true; }
    if (route.name === 'sop') {
      const o = getSop(route.id);
      if (!o) return false;
      const how = await modal({
        title: '貼上的照片要做什麼？',
        body: '<p>「照片辨識」會讀取表單上的文字並填入食材明細；「設為照片」會放進這份 SOP 的照片欄。</p>',
        buttons: [{ label: '取消', value: null }, { label: '設為照片', value: 'photo' }, { label: '照片辨識', cls: 'primary', value: 'ocr' }],
      });
      if (how === 'ocr') sopOcr(o, file);
      else if (how === 'photo') { try { o.photo = await resizeImage(file); sopTouch(o); render(); toast('已設為 SOP 照片'); } catch (e) { toast(e.message, 'err'); } }
      return true;
    }
    toast('照片可以貼到「編輯食譜」或「SOP」頁面', 'err');
    return true;
  }
  const imageFrom = list => [...(list || [])].map(it => (it.getAsFile ? (it.kind === 'file' ? it.getAsFile() : null) : it)).find(f => f && /^image\//.test(f.type));
  document.addEventListener('paste', e => {
    if ($('#modal.open')) return;
    const cd = e.clipboardData;
    const img = cd && imageFrom(cd.items && cd.items.length ? cd.items : cd.files);
    if (!img) return;                                                  // 沒有圖片：照常貼上文字
    const t = e.target, inField = t && /^(INPUT|TEXTAREA)$/.test(t.tagName) && t.type !== 'file';
    if (inField && cd.getData('text/plain')) return;                   // 在輸入框且也有文字：貼文字
    e.preventDefault();
    useImage(img);
  });
  // 拖曳照片檔到視窗上
  document.addEventListener('dragover', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); document.body.classList.add('drop-on'); } });
  document.addEventListener('dragleave', e => { if (!e.relatedTarget) document.body.classList.remove('drop-on'); });
  document.addEventListener('drop', e => {
    document.body.classList.remove('drop-on');
    const img = e.dataTransfer && imageFrom(e.dataTransfer.files);
    if (!img) return;
    e.preventDefault();
    if (!$('#modal.open')) useImage(img);
  });

  function showShortcuts() {
    const groups = {};
    for (const [k, d, pg] of SHORTCUTS) (groups[pg] = groups[pg] || []).push([k, d]);
    const body = Object.entries(groups).map(([pg, list]) => `<h4 class="kbd-h">${PAGE_NAMES[pg] || pg}</h4>
      <table class="kbd-table">${list.map(([k, d]) => `<tr><td>${k.split('+').map(x => `<kbd>${esc(x)}</kbd>`).join('+')}</td><td>${esc(d)}</td></tr>`).join('')}</table>`).join('');
    modal({ title: '⌨ 快捷鍵', body: `<div class="kbd-list">${body}</div><p class="hint">照片可以直接按 Ctrl+V 貼上，或把圖片檔拖進視窗：編輯食譜＝設為食譜照片；SOP 表單＝照片辨識或設為照片；SOP 列表＝從照片建立。<br>Mac 用 ⌘ 代替 Ctrl。正在打字時只有組合鍵（Ctrl／Alt）有效；注音選字時不會觸發。</p>`, buttons: [{ label: '關閉', cls: 'primary', value: null }] });
    const md = $('#modal .modal'); if (md) md.classList.add('kbd-modal');
  }

  // ---------------------------------------------------------------- 單價表
  let priceFilter = '';
  function unitPriceText(p) {
    if (p.price == null || !p.perQty) return '';
    const u = U.lookup(p.perUnit);
    const per = p.price / p.perQty;
    if (!u) return p.perUnit ? `${money(per)}/${esc(p.perUnit)}` : '';
    if (u.dim === 'mass') return `${money(per / u.f * 1000)}/kg · ${money(per / u.f * 600)}/台斤`;
    return `${money(per / u.f * 1000)}/L`;
  }
  function viewPrices() {
    const used = new Map();
    for (const r of db.recipes) for (const i of r.ingredients) { const k = normName(i.name); if (k && !isHead(i)) used.set(k, (used.get(k) || 0) + 1); }
    const q = normName(priceFilter);
    const rows = db.prices.map((p, k) => ({ p, k })).filter(({ p }) => !q || normName(p.name).includes(q));
    return `<div class="page">
      <div class="page-head"><h1 class="head-title">食材單價表</h1><div class="spacer"></div>
        <button class="btn" data-act="price-import">從食譜帶入食材</button><button class="btn primary" data-act="price-add">＋ 新增</button></div>
      <p class="muted">食材名稱需與食譜中的名稱相同才會計算成本。單位可與食譜不同，例如單價用「台斤」、食譜用「g」會自動換算。</p>
      <input id="pq" class="search" type="search" placeholder="搜尋食材…" value="${esc(priceFilter)}">
      <section class="card">
        <div class="price-head"><span>食材名稱</span><span>價格（元）</span><span>每</span><span>單位</span><span>換算單價</span><span></span></div>
        <div class="price-list">${rows.map(({ p, k }) => `<div class="price-row">
          <input data-price="${k}.name" value="${esc(p.name)}" placeholder="食材名稱">
          <input data-price="${k}.price" value="${p.price == null ? '' : fmt(p.price)}" inputmode="decimal" placeholder="價格">
          <input data-price="${k}.perQty" value="${fmt(p.perQty)}" inputmode="decimal">
          <input data-price="${k}.perUnit" value="${esc(p.perUnit)}" list="dl-units" placeholder="單位">
          <span class="muted small up" id="up${k}">${unitPriceText(p)}${used.get(normName(p.name)) ? '' : (p.name.trim() ? ' <span class="badge">未使用</span>' : '')}</span>
          <button class="icon danger" data-act="price-rm" data-k="${k}" title="刪除">✕</button></div>`).join('') || '<p class="muted">尚無資料。</p>'}</div>
      </section>
      <datalist id="dl-units">${COMMON_UNITS.map(u => `<option value="${u}">`).join('')}</datalist>
    </div>`;
  }

  // ---------------------------------------------------------------- 設定 / 資料
  function viewSettings() {
    return `<div class="page settings-page">
      <div class="page-head"><h1 class="head-title">設定與資料</h1><div class="spacer"></div>
        ${IS_MOBILE ? '' : '<button class="btn" data-act="kbd-help">⌨ 快捷鍵（F1）</button>'}</div>
      <section class="card"><h2>食材單價表</h2>
        <p class="muted small">食譜和小抄的成本用這裡的單價計算。</p>
        <a class="btn" href="#/prices">💲 開啟單價表（${db.prices.length} 筆）</a></section>
      ${viewRingSettings()}
      <section class="card">
        <h2>單位顯示</h2>
        <label class="fld">倍數換算後的單位顯示方式${unitModeSelect('unitMode3')}</label>
        <details class="units-ref"><summary>單位對照表</summary>
          <table class="ref-table"><tbody>${U.DEFS.map(([names, dim, f, canon]) => `<tr><td>${esc(canon)}</td><td>${f === 1 ? '基準' : `= ${fmt(f)} ${dim === 'mass' ? 'g' : 'ml'}`}</td><td class="muted small">${esc(names.filter(n => n !== canon).join('、'))}</td></tr>`).join('')}</tbody></table>
          <p class="hint">顆、包、把等計數單位會直接乘以倍數，不做換算。</p>
        </details>
      </section>
      <section class="card">
        <h2>☁ Google 雲端同步</h2>
        ${db.cloud ? `
          <p>已連線到你的 Google 試算表（即時同步）：修改約 1 秒內上傳，其他裝置約 10 秒內更新。</p>
          <p class="small muted" id="cloudInfo"></p>
          <div class="btn-row">
            <button class="btn primary" data-act="cloud-sync">立即同步</button>
            <button class="btn" data-act="cloud-off">中斷連線</button>
          </div>` : `
          <p class="muted">把資料存到你自己的 Google 試算表，手機、平板、電腦版都讀寫同一份。
            設定方式請看 <a href="https://github.com/wu8858009/kitchen-sop/blob/main/cloud/%E8%A8%AD%E5%AE%9A%E8%AA%AA%E6%98%8E.md" target="_blank" rel="noopener">雲端設定說明</a>。</p>
          <div class="form-grid cloud-form">
            <label class="fld wide">Apps Script 網頁應用程式網址<input id="cloudUrl" value="${esc(window.KSOP_CLOUD_URL || '')}" placeholder="https://script.google.com/macros/s/…/exec" autocomplete="off"></label>
            <label class="fld wide">存取密碼<input id="cloudKey" type="password" autocomplete="off" placeholder="至少 6 個字；第一次連線時輸入的密碼會成為雲端的存取密碼"></label>
          </div>
          <div class="btn-row"><button class="btn primary" data-act="cloud-connect">連線</button></div>`}
      </section>
      <section class="card">
        <h2>備份與還原</h2>
        <p class="muted">匯出的 JSON 檔可在手機版與電腦版之間互相匯入。</p>
        <div class="btn-row">
          <button class="btn primary" data-act="export">⬇ 匯出備份</button>
          <label class="btn">⬆ 匯入備份<input type="file" accept=".json,application/json" data-act-change="import" hidden></label>
          <button class="btn" data-act="seed">載入範例食譜</button>
        </div>
        <p class="small muted" id="dataInfo"></p>
      </section>
      <section class="card">
        <h2>危險區</h2>
        <button class="btn danger" data-act="wipe">清除全部資料</button>
      </section>
      <p class="muted small center">廚房 SOP 食譜及倍數計算系統 v${APP_VERSION}${IS_DESKTOP ? '（Windows 版）' : '（網頁版）'}</p>
    </div>`;
  }
  function viewRingSettings() {
    const cur = db.settings.ringTone || 'beep', f = ringFile();
    const row = (id, name, extra = '') => `<div class="ring-row">
        <label class="ck-lbl"><input type="radio" name="ringTone" value="${id}" data-act-change="ring-tone" ${cur === id ? 'checked' : ''} ${id === 'custom' && !f ? 'disabled' : ''}> ${name}</label>${extra}
        <button class="btn sm" data-act="ring-test" data-tone="${id}" ${id === 'custom' && !f ? 'disabled' : ''}>▶ 試聽</button></div>`;
    return `<section class="card">
        <h2>⏰ 計時器鈴聲</h2>
        <div class="ring-list">
          ${Object.entries(RING_TONES).map(([id, t]) => row(id, t.name)).join('')}
          ${row('custom', '自訂音檔', `<span class="muted small ring-file">${f ? esc(f.name) : '尚未上傳'}</span>`)}
        </div>
        <div class="btn-row">
          <label class="btn">⬆ 上傳鈴聲<input type="file" accept="audio/*,.mp3,.m4a,.wav,.ogg,.aac" data-act-change="ring-file" hidden></label>
          ${f ? '<button class="btn ghost" data-act="ring-file-rm">移除自訂音檔</button>' : ''}
        </div>
        <label class="fld ring-vol">音量 <span id="ringVolTxt">${Math.round(ringVol() * 100)}%</span>
          <input type="range" min="0" max="1" step="0.05" value="${ringVol()}" data-act-change="ring-vol" id="ringVol"></label>
        <p class="hint">時間到會重複響鈴 2 分鐘，或按「關閉」停止。自訂音檔（mp3、m4a、wav，3 MB 以內）只存在這台裝置；鈴聲選擇會同步到其他裝置，沒有音檔的裝置會改用嗶嗶聲。手機請確認沒有開靜音。</p>
      </section>`;
  }

  async function fillSettingsInfo() {
    const el = $('#dataInfo');
    const base = `共 ${db.recipes.length} 道食譜、${db.prices.length} 筆單價。`;
    el.textContent = base;
    try {
      if (IS_DESKTOP) { const p = await (await desktopApi()).data_path(); el.textContent = base + ' 資料檔：' + p; }
      else if (navigator.storage && navigator.storage.persisted) { const ok = await navigator.storage.persisted(); el.textContent = base + (ok ? ' 資料已設定為持久保存於此裝置。' : ' 資料儲存在此瀏覽器中，清除瀏覽資料會一併刪除，請定期匯出備份。'); }
    } catch (e) { /* ignore */ }
  }

  async function exportData() {
    const text = JSON.stringify({ app: 'kitchen-sop', exportedAt: new Date().toISOString(), ...shareable(db) }, null, 1);
    const name = `廚房SOP備份_${dateStr()}.json`;
    if (IS_DESKTOP) {
      const p = await (await desktopApi()).export_file(text, name);
      if (p) toast('已匯出：' + p);
      return;
    }
    const file = new File([text], name, { type: 'application/json' });
    if (/iPhone|iPad|Android/i.test(navigator.userAgent) && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }

  async function importData(file) {
    let data;
    try { data = JSON.parse(await file.text()); } catch (e) { return toast('檔案不是有效的 JSON 備份', 'err'); }
    if (!data || !Array.isArray(data.recipes)) return toast('這不是廚房 SOP 的備份檔', 'err');
    const inc = normalizeDb(data);
    const how = await modal({
      title: '匯入備份',
      body: `<p>備份內含 ${inc.recipes.length} 道食譜、${inc.prices.length} 筆單價。</p>
        <p><b>合併</b>：保留現有資料，相同食譜（同 ID）與同名單價以備份覆蓋。<br><b>全部取代</b>：刪除目前所有資料，改用備份內容。</p>`,
      buttons: [{ label: '取消', value: null }, { label: '全部取代', cls: 'danger', value: 'replace' }, { label: '合併', cls: 'primary', value: 'merge' }],
    });
    if (!how) return;
    const now = Date.now();
    inc.recipes.forEach(r => { r.updatedAt = now; delete inc.deleted[r.id]; delete db.deleted[r.id]; });
    if (how === 'replace') {
      const deleted = { ...db.deleted };
      db.recipes.forEach(r => { if (!inc.recipes.some(x => x.id === r.id)) deleted[r.id] = now; });
      db = { ...inc, deleted, pricesUpdatedAt: now, cloud: db.cloud, sync: db.sync };
    } else {
      db.pricesUpdatedAt = now;
      for (const r of inc.recipes) { const k = db.recipes.findIndex(x => x.id === r.id); if (k >= 0) db.recipes[k] = r; else db.recipes.push(r); }
      for (const p of inc.prices) { const k = db.prices.findIndex(x => normName(x.name) === normName(p.name)); if (k >= 0) db.prices[k] = p; else db.prices.push(p); }
      db.inv = mergeInv(inc.inv, db.inv);
      for (const o of inc.sops) { o.updatedAt = now; delete db.deleted[o.id]; const k = db.sops.findIndex(x => x.id === o.id); if (k >= 0) db.sops[k] = o; else db.sops.push(o); }
    }
    persist(true);
    render();
    toast(`匯入完成（${how === 'replace' ? '全部取代' : '合併'}）`);
  }

  function seed() {
    const s = sampleData();
    const have = new Set(db.recipes.map(r => r.name));
    const add = s.recipes.filter(r => !have.has(r.name));
    db.recipes.push(...add);
    for (const p of s.prices) if (!db.prices.some(x => normName(x.name) === normName(p.name))) { db.prices.push(p); db.pricesUpdatedAt = Date.now(); }
    persist(true);
    render();
    toast(add.length ? `已加入 ${add.length} 道範例食譜` : '範例食譜已經存在');
  }

  // ---------------------------------------------------------------- 越南文翻譯（Apps Script 內建的 Google 翻譯）
  // 越南文欄位留空就會自動補上；中文改了而越南文沒手動改過，編輯時會清掉讓它重新翻譯。
  function viTasks(r) {
    const t = [];
    const add = (o, k, kv) => { const src = String(o[k] || '').trim(); if (src && !String(o[kv] || '').trim()) t.push([o, kv, src]); };
    add(r, 'name', 'nameVi'); add(r, 'category', 'categoryVi'); add(r, 'notes', 'notesVi');
    r.ingredients.forEach(i => { add(i, 'name', 'nameVi'); add(i, 'note', 'noteVi'); add(i, 'group', 'groupVi'); });
    r.steps.forEach(x => add(x, 'text', 'textVi'));
    return t;
  }
  function cheatViTasks() {
    const t = [];
    cheatCfg().items.filter(x => x.type === 'note').forEach(n => {
      if (String(n.title || '').trim() && !n.titleVi) t.push([n, 'titleVi', n.title.trim()]);
      if (String(n.text || '').trim() && !n.textVi) t.push([n, 'textVi', n.text.trim()]);
    });
    return t;
  }
  async function fetchVi(texts) {
    if (!db.cloud) throw new Error('需要先連線 Google 雲端才能自動翻譯');
    const uniq = [...new Set(texts)], out = new Map();
    for (let i = 0; i < uniq.length; i += 100) {
      const part = uniq.slice(i, i + 100);
      const j = await cloudCall({ a: 'translate', texts: part });
      part.forEach((src, k) => { const v = j.vi && j.vi[k]; if (v) out.set(src, String(v)); });
    }
    return out;
  }
  const applyVi = (tasks, map) => tasks.reduce((n, [o, kv, src]) => (map.has(src) ? ((o[kv] = map.get(src)), n + 1) : n), 0);

  let viBusy = false;
  const viTried = new Set();
  async function autoTranslate(force) {
    if (viBusy || !db.cloud || !viOn()) return;
    const todo = db.recipes.filter(r => viTasks(r).length && (force || !viTried.has(r.id + ':' + r.updatedAt)));
    const notes = cheatViTasks();
    if (!todo.length && !notes.length) { if (force) toast('全部食譜都已有越南文'); return; }
    viBusy = true;
    if (force) toast('翻譯中…');
    try {
      let changed = 0;
      for (const r0 of todo) {
        viTried.add(r0.id + ':' + r0.updatedAt);
        const map = await fetchVi(viTasks(r0).map(t => t[2]));
        const r = getRecipe(r0.id); // 翻譯期間資料可能已被同步換掉
        if (!r || !applyVi(viTasks(r), map)) continue;
        r.updatedAt = Date.now();
        viTried.add(r.id + ':' + r.updatedAt);
        changed++;
        persist();
      }
      if (notes.length) { const map = await fetchVi(notes.map(t => t[2])); if (applyVi(cheatViTasks(), map)) { changed++; persist(); } }
      if (changed) refreshAfterSync();
      if (force) toast(changed ? '已翻譯' : '沒有需要翻譯的內容');
    } catch (e) {
      if (force) toast('翻譯失敗：' + e.message, 'err');
    } finally { viBusy = false; }
  }

  async function translateDraft() {
    const tasks = viTasks(draft.r);
    if (!tasks.length) return toast('沒有需要翻譯的內容');
    toast('翻譯中…');
    try {
      const d = draft, map = await fetchVi(tasks.map(t => t[2]));
      if (draft !== d) return;
      if (applyVi(viTasks(d.r), map)) { d.dirty = true; rerenderEdit(); }
      toast('已翻譯');
    } catch (e) { toast('翻譯失敗：' + e.message, 'err'); }
  }

  // ---------------------------------------------------------------- Google 雲端同步
  // 本機資料是離線快取；有設定雲端時，修改後自動上傳，並定期檢查雲端版本號。
  // 版本衝突時以「每道食譜的更新時間」合併，刪除用墓碑（deleted）傳遞。
  let cloudBusy = false, cloudAgain = false, cloudTimer = null, cloudState = { s: 'off', msg: '' };
  const LIVE_POLL_MS = 10000; // 即時同步：App 顯示中時每 10 秒檢查雲端版本

  function hashStr(str) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
  }

  async function cloudCall(body, cfg) {
    cfg = cfg || db.cloud;
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 60000);
    let res;
    try {
      res = await fetch(cfg.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ ...body, key: cfg.key }), signal: ctl.signal });
    } catch (e) {
      throw new Error(navigator.onLine === false ? '目前沒有網路' : e.name === 'AbortError' ? '連線逾時' : '無法連線到 Google');
    } finally { clearTimeout(t); }
    let j;
    try { j = await res.json(); } catch (e) { throw new Error('回應格式不對：請確認是「網頁應用程式」的 /exec 網址，且存取權為「所有人」'); }
    if (!j.ok && !j.conflict && !j.needPhotos) { const err = new Error(j.error || '雲端發生錯誤'); err.auth = !!j.auth; throw err; }
    return j;
  }

  function cloudPayload() {
    const photos = {};
    const recipes = db.recipes.map(r => {
      const { photo, ...rest } = r;
      let h = '';
      if (photo) { h = hashStr(photo); photos[h] = photo; }
      return { ...rest, photoHash: h };
    });
    const sops = db.sops.map(o => {
      const { photo, ...rest } = o;
      let h = '';
      if (photo) { h = hashStr(photo); photos[h] = photo; }
      const t = sopTotals(o);
      return { ...rest, photoHash: h, totals: { cost: t.cost, profit: t.profit } };
    });
    return { db: { ...shareable(db), recipes, sops }, photos };
  }

  async function pushOnce(force) {
    const p = cloudPayload();
    const pick = keep => Object.fromEntries(Object.entries(p.photos).filter(([h]) => keep(h)));
    const known = new Set(db.sync.photos);
    const base = { a: 'save', baseRev: db.sync.rev, force: !!force, db: p.db };
    let r = await cloudCall({ ...base, photos: pick(h => !known.has(h)) });
    if (r.needPhotos) { const need = r.needPhotos; r = await cloudCall({ ...base, photos: pick(h => need.includes(h)) }); }
    if (r.photoHashes) db.sync.photos = r.photoHashes;
    return r;
  }

  // 已儲存的標籤逐筆合併（新的贏）；同品名只留最新一筆，刪過的不會被另一台裝置救回來
  function mergeLabels(a, b, deleted) {
    const map = new Map();
    for (const x of [...(a || []), ...(b || [])]) {
      const k = normName(x.name), o = map.get(k);
      if (!(deleted[x.id] >= (x.at || 0)) && (!o || (x.at || 0) > (o.at || 0))) map.set(k, x);
    }
    return [...map.values()].sort((p, q) => (q.at || 0) - (p.at || 0));
  }
  function mergeDb(local, remote) {
    const deleted = { ...remote.deleted };
    for (const [k, v] of Object.entries(local.deleted)) deleted[k] = Math.max(deleted[k] || 0, v);
    const map = new Map(remote.recipes.map(r => [r.id, r]));
    for (const r of local.recipes) { const o = map.get(r.id); if (!o || (r.updatedAt || 0) >= (o.updatedAt || 0)) map.set(r.id, r); }
    const recipes = [...map.values()].filter(r => !(deleted[r.id] >= (r.updatedAt || 0)));
    const smap = new Map(remote.sops.map(o => [o.id, o]));
    for (const o of local.sops) { const x = smap.get(o.id); if (!x || (o.updatedAt || 0) >= (x.updatedAt || 0)) smap.set(o.id, o); }
    const sops = [...smap.values()].filter(o => !(deleted[o.id] >= (o.updatedAt || 0)));
    const localPrices = local.pricesUpdatedAt >= remote.pricesUpdatedAt;
    return {
      ...local, recipes, sops, deleted, inv: mergeInv(local.inv, remote.inv),
      settings: { ...local.settings, labels: { ...LABEL_DEF, ...local.settings.labels, saved: mergeLabels((local.settings.labels || {}).saved, (remote.settings.labels || {}).saved, deleted) } },
      prices: localPrices ? local.prices : remote.prices,
      pricesUpdatedAt: Math.max(local.pricesUpdatedAt, remote.pricesUpdatedAt),
    };
  }

  function applyRemote(L, merge) {
    const remote = normalizeDb(L.db);
    if (!Array.isArray(L.db && L.db.sops)) remote.sops = db.sops; // 舊版後端沒有 SOP：保留本機的
    if (!(L.db && L.db.inv)) remote.inv = db.inv;                  // 舊版後端沒有盤點訂貨：保留本機的
    const sync = { ...db.sync, rev: L.rev, photos: L.photoHashes || db.sync.photos };
    if (merge) { db = mergeDb(db, remote); db.sync = { ...sync, dirty: true }; }
    else db = { ...remote, cloud: db.cloud, sync: { ...sync, dirty: false } };
    saveLocal(true);
    refreshAfterSync();
  }

  function refreshAfterSync() {
    if (route.name === 'edit' || route.name === 'new') return; // 編輯中不打斷，儲存時會再合併
    const a = document.activeElement;
    if (a && $('#app').contains(a) && /INPUT|TEXTAREA|SELECT/.test(a.tagName)) return;
    const y = window.scrollY;
    render();
    window.scrollTo(0, y);
  }

  function setSync(s, msg = '') {
    if (s === 'ok' && cloudState.s !== 'ok') setTimeout(autoTranslate, 1500);
    cloudState = { s, msg };
    const el = $('#syncPill');
    if (!el) return;
    const map = { ok: ['☁', '已同步'], busy: ['⟳', '同步中'], pending: ['☁', '待同步'], err: ['⚠', '同步失敗'] };
    el.hidden = s === 'off';
    if (s === 'off') return;
    el.className = 'sync-pill ' + s;
    el.innerHTML = `<span>${map[s][0]}</span><span class="sp-t">${map[s][1]}</span>`;
    el.title = msg || (db.sync.at ? '上次同步：' + new Date(db.sync.at).toLocaleString() : '');
    const info = $('#cloudInfo');
    if (info) info.textContent = `${map[s][1]}${msg ? '：' + msg : ''}${db.sync.at ? '　上次同步 ' + new Date(db.sync.at).toLocaleString() : ''}`;
  }

  function scheduleCloudSync(delay = 800) {
    clearTimeout(cloudTimer);
    cloudTimer = setTimeout(cloudSync, delay);
  }

  async function cloudSync() {
    clearTimeout(cloudTimer);
    if (!db.cloud || loadFailed) return setSync('off');
    if (cloudBusy) { cloudAgain = true; return; }
    cloudBusy = true;
    if (db.sync.dirty || cloudState.s !== 'ok') setSync('busy');
    try {
      for (let attempt = 0; attempt < 5; attempt++) {
        if (!db.sync.dirty) {
          const { rev } = await cloudCall({ a: 'rev' });
          if (rev !== db.sync.rev) {
            setSync('busy');
            const L = await cloudCall({ a: 'load' });
            applyRemote(L, db.sync.dirty); // 下載期間若有新修改就改用合併
            if (db.sync.dirty) continue;
          }
          break;
        }
        const seq = changeSeq;
        setSync('busy');
        const r = await pushOnce(db.sync.force);
        if (r.ok) {
          db.sync.rev = r.rev;
          db.sync.force = false;
          if (seq === changeSeq) db.sync.dirty = false;
          saveLocal(true);
          if (!db.sync.dirty) break;
        } else if (r.conflict) {
          applyRemote(await cloudCall({ a: 'load' }), true);
        } else throw new Error('上傳照片失敗');
      }
      db.sync.at = Date.now();
      saveLocal();
      setSync(db.sync.dirty ? 'pending' : 'ok');
    } catch (e) {
      setSync(db.sync.dirty ? 'pending' : 'err', e.message);
      if (e.auth) toast('雲端存取密碼錯誤，請到設定重新連線', 'err');
    } finally {
      cloudBusy = false;
      if (cloudAgain) { cloudAgain = false; scheduleCloudSync(300); }
    }
  }

  async function cloudConnect() {
    const url = $('#cloudUrl').value.trim(), key = $('#cloudKey').value;
    if (!/^https:\/\/script\.google(usercontent)?\.com\/\S+$/.test(url) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(url)) {
      return toast('請貼上 Apps Script 網頁應用程式網址（https://script.google.com/…/exec）', 'err');
    }
    if (!key) return toast('請輸入存取密碼', 'err');
    const cfg = { url, key };
    const btn = $('[data-act="cloud-connect"]');
    btn.disabled = true; btn.textContent = '連線中…';
    try {
      const info = await cloudCall({ a: 'ping' }, cfg);
      let mode = 'upload';
      // 雲端只要有食譜、SOP 或盤點資料就不能直接覆蓋
      if (info.rev > 0 && (info.recipes > 0 || info.sops > 0 || info.inv > 0)) {
        const localHas = db.recipes.length || db.sops.length || Object.values(db.inv.weeks).some(w => Object.values(w).some(r => r.a.some(Boolean)));
        mode = localHas && !db.pristine ? await modal({
          title: '雲端已有資料',
          body: `<p>雲端有 ${info.recipes} 道食譜、${info.sops || 0} 份 SOP${info.inv > 0 ? `、${info.inv} 週盤點訂貨` : ''}；這台裝置有 ${db.recipes.length} 道食譜、${db.sops.length} 份 SOP。要怎麼處理？</p>
            <p class="small"><b>下載雲端</b>：用雲端資料取代這台的資料。<br><b>合併兩邊</b>：兩邊的食譜都保留，同一道以較新的為準。<br><b>上傳本機</b>：用這台的資料覆蓋雲端。</p>`,
          buttons: [{ label: '取消', value: null }, { label: '上傳本機', cls: 'danger', value: 'upload' }, { label: '合併兩邊', value: 'merge' }, { label: '下載雲端', cls: 'primary', value: 'download' }],
        }) : 'download';
        if (!mode) return;
      }
      db.cloud = cfg;
      db.sync = { rev: info.rev, dirty: false, force: false, photos: [], at: 0 };
      if (mode === 'download') applyRemote(await cloudCall({ a: 'load' }), false);
      else if (mode === 'merge') applyRemote(await cloudCall({ a: 'load' }), true);
      else { db.sync.dirty = true; db.sync.force = true; }
      saveLocal(true);
      await cloudSync();
      render();
      toast(cloudState.s !== 'ok' ? '已設定，但同步失敗：' + cloudState.msg
        : info.claimed ? '已連線，並設定了雲端存取密碼；其他裝置請輸入同一組密碼' : '已連線 Google 雲端', cloudState.s === 'ok' ? '' : 'err');
    } catch (e) {
      toast('連線失敗：' + e.message, 'err');
    } finally {
      if (btn.isConnected) { btn.disabled = false; btn.textContent = '連線'; }
    }
  }

  // ---------------------------------------------------------------- 事件
  document.addEventListener('click', e => { if (e.target.matches && e.target.matches('[data-cheat-back]')) closeCheatEditor(); });
  // ---------------------------------------------------------------- 滑鼠停留說明
  // 依按鈕的 data-act 查表，新頁面重畫也不用另外綁；手機沒有滑鼠就不顯示
  const TAB_TIPS = {
    list: '所有食譜，可搜尋、分類，點進去換算份量', sops: '依紙本表單格式管理 SOP，計算採購量、成本與毛利', plan: '把多道菜加在一起，彙總要準備的食材與成本',
    cheat: '把食譜濃縮成卡片，列印後貼在工作台', labels: '製作食材標籤，可印到精臣 B3S 或 A4 紙', inv: '每週盤點與訂貨表，可列印或複製訂貨單', settings: '單價表、雲端同步、備份與提示音',
  };
  const ACT_TIPS = {
    add: '新增一列', 'add-head': '新增小標題，把食材分段', addplan: '把這道菜依目前倍數加到備料單', anchor: '輸入手邊現有的量，自動反推倍數', bulk: '一次貼上多行文字，每行變成一列',
    'cancel-edit': '放棄這次修改，回到上一頁', cat: '只顯示這個分類的食譜', 'cheat-show': '讓這張卡片重新出現在小抄', 'cheat-clear': '隱藏所有食譜卡片、刪除文字卡，食譜不會被刪除', 'cheat-close': '關閉這個視窗', 'cheat-edit': '隱藏或顯示卡片，調整順序、倍數和步驟',
    'cheat-from-plan': '把備料單的菜色全部做成小抄卡片', 'cheat-from-recipe': '把小抄這張卡片改成目前倍數', 'cheat-mv': '調整卡片順序', 'cheat-note': '新增一張自己打字的卡片', 'cheat-print': '列印目前的小抄卡片', 'cheat-rm': '隱藏這張卡片，食譜不會被刪除',
    check: '勾選表示這項已備好', 'cloud-connect': '用網址和密碼連到 Google 雲端同步資料', 'cloud-off': '這台裝置停止同步，雲端資料保留', 'cloud-pill': '雲端同步狀態，點一下查看或立即同步', 'cloud-sync': '馬上和雲端同步一次',
    'delete-recipe': '刪除這道食譜', dup: '複製一份，再改成新食譜', export: '把所有資料存成備份檔', 'inv-copy': '把當天訂貨量整理成文字，可貼到 LINE', 'inv-day': '切換顯示哪一天或整週', 'inv-items': '編輯品項的品號、規格、單價與停用狀態',
    'inv-print': '列印這週的盤點訂貨表', 'inv-week': '切換週次', 'kbd-help': '查看所有鍵盤快捷鍵',
    'label-a4': '排版到 A4 紙，用一般印表機印出後沿虛線裁開', 'label-browser': '電腦版視窗不能連印表機，把這張標籤帶到 Edge／Chrome 列印', 'label-connect': '連線精臣 B3S 標籤機', 'label-disconnect': '中斷和標籤機的連線', 'label-load': '把這張標籤的內容帶入，日期用當天重算',
    'label-png': '存成 PNG 圖片，可匯入精臣 App 列印', 'label-print': '把這張標籤印到已連線的 B3S', 'label-rm': '刪除這張已儲存的標籤', 'label-save': '儲存內容，下次點一下就能帶入；相同品名會更新', 'label-sys': '用系統印表機列印，紙張設成標籤尺寸',
    mult: '把份量換成這個倍數', mv: '調整順序', 'photo-rm': '移除這張照片', 'plan-add': '把選單中的菜加到備料單', 'plan-check': '勾選表示這項已備好', 'plan-clear': '清空備料單，食譜不會被刪除', 'plan-rm': '從備料單移除這道菜',
    'price-add': '新增一筆食材單價', 'price-import': '把食譜用到、還沒有單價的食材加進來', 'price-rm': '刪除這筆單價', print: '列印這一頁', 'ring-file-rm': '移除自訂提示音，改回內建鈴聲', 'ring-test': '播放目前選的提示音', rm: '刪除這一列', 'save-recipe': '儲存這道食譜', seed: '載入內建的範例食譜',
    'sop-del': '刪除這份 SOP', 'sop-dup': '複製一份 SOP', 'sop-from-recipe': '從選擇的食譜帶入食材', 'sop-new': '新增一份空白 SOP', 'sop-photo-rm': '移除這張成品照片', 'sop-print': '列印這份 SOP 表單', 'sop-row-add': '新增一列食材', 'sop-row-mv': '調整順序', 'sop-row-rm': '刪除這一列',
    stepdone: '點一下標記這個步驟已完成', 't-add': '倒數多加 1 分鐘', 't-pause': '暫停或繼續倒數', 't-x': '關閉這個計時器', timer: '開始這個步驟的倒數計時', 'tr-draft': '用 Google 翻譯填入空白的越南文欄位', uncheck: '清除所有已勾選的食材', wake: '烹調時保持螢幕不關閉', wipe: '清除這台裝置的全部資料',
  };
  const ED_TIPS = { add: '在表格最後新增一個品項', up: '往上移一列', down: '往下移一列', rm: '刪除這個品項，已填的數字會保留' };
  const LABEL_TIPS = {
    name: '印在標籤最上方，可從食譜、SOP、盤點品項挑選', qty: '例如 2 公斤；留空就不印', made: '預設今天；清空就不印', days: '填天數會自動算出到期日', exp: '也可以直接選日期，保存天數會清空', who: '留空就不印', note: '例如保存方式；留空就不印', copies: '要印幾張',
    size: '選和標籤紙相同的尺寸', w: '標籤紙寬度，B3S 最大可印 72 公釐', h: '標籤紙高度', paper: '選和標籤紙相同的種類，一般貼紙選間隙紙', density: '數字越大印得越黑', task: '連得上卻印不出來時才需要換', a4fill: '勾選就排滿一頁；不勾就依「張數」排版',
  };
  const CHEAT_OPT_TIPS = { ing: '卡片上顯示食材用量', notes: '卡片上顯示食譜備註', cost: '卡片上顯示成本', vi: '卡片上加入越南文', steps: '選擇卡片要列出哪些步驟；沒標重點的菜會全部列出', layout: '卡片的排列方式', size: '卡片的字體大小' };
  const ID_TIPS = { mult: '輸入倍數，例如 2、1.5 或 /3', target: '輸入想要的份量，自動算出倍數', planAdd: '選擇要加入備料單的菜', cheatAdd: '選擇要做成卡片的食譜', labelQ: '用品名搜尋已儲存的標籤', invEdStop: '顯示或收起已停用的品項' };
  const TEXT_TIPS = { '選擇照片': '選一張照片放在這裡', '📷 照片辨識': '拍下或選擇紙本 SOP，自動辨識填入表格', '📷 從照片建立': '拍下或選擇紙本 SOP，自動建立一份新的', '⬆ 上傳鈴聲': '用自己的音檔當計時器提示音', '⬆ 匯入備份': '從備份檔還原資料', '雲端設定說明': '查看 Google 雲端同步的設定步驟' };
  const HREF_TIPS = [[/^#\/new/, '新增一道食譜'], [/^#\/edit\//, '編輯這道食譜的內容'], [/^#\/r\//, '開啟這道食譜'], [/^#\/sop\//, '開啟這份 SOP'], [/^#\/sops$/, '回 SOP 列表'], [/^#\/prices$/, '開啟食材單價表'], [/^#\/?$/, '回食譜列表']];
  const tipOther = el => {
    if (el.id && ID_TIPS[el.id]) return ID_TIPS[el.id];
    if (/^unitMode/.test(el.id || '')) return '選擇換算後的單位顯示方式';
    if (el.dataset.cheatOpt) return CHEAT_OPT_TIPS[el.dataset.cheatOpt] || '';
    if (el.dataset.cheatSteps != null) return '一行打一個步驟，會存回這道食譜';
    if (el.dataset.cheatMult != null) return '這張卡片的倍數，例如 2 或 /3';
    if (/\.key$/.test(el.dataset.bind || '')) return '標記為重點，小抄可以只列重點步驟';
    if (el.tagName === 'A') {
      const h = el.getAttribute('href') || '', m = HREF_TIPS.find(([re]) => re.test(h));
      if (m) return m[1];
    }
    if (el.tagName === 'A' || el.tagName === 'LABEL') return TEXT_TIPS[el.textContent.trim()] || '';
    return '';
  };
  const tipBox = document.createElement('div');
  tipBox.id = 'tip'; tipBox.setAttribute('role', 'tooltip');
  document.body.appendChild(tipBox);
  let tipEl = null, tipTimer = 0;
  function tipText(el) {
    if (el.dataset.tip) return el.dataset.tip;
    return (el.dataset.act && ACT_TIPS[el.dataset.act]) || (el.dataset.tab && TAB_TIPS[el.dataset.tab]) || (el.dataset.ed && ED_TIPS[el.dataset.ed]) || (el.dataset.label && LABEL_TIPS[el.dataset.label]) || tipOther(el);
  }
  const tipTarget = t => {
    for (let el = t; el && el !== document.body; el = el.parentElement) {
      if (!el.dataset) continue;
      if (el.title) { el.dataset.tip = el.title; if (!el.getAttribute('aria-label')) el.setAttribute('aria-label', el.title); el.removeAttribute('title'); } // 換成自己的說明，避免同時跳兩個
      if (tipText(el)) return el;
    }
    return null;
  };
  function tipHide() { clearTimeout(tipTimer); tipEl = null; tipBox.classList.remove('show'); }
  function tipShow(el) {
    tipBox.textContent = tipText(el);
    tipBox.classList.add('show');
    const r = el.getBoundingClientRect(), b = tipBox.getBoundingClientRect(), gap = 8;
    const below = r.bottom + gap + b.height <= window.innerHeight;
    tipBox.style.left = Math.max(8, Math.min(window.innerWidth - b.width - 8, r.left + r.width / 2 - b.width / 2)) + 'px';
    tipBox.style.top = (below ? r.bottom + gap : Math.max(8, r.top - gap - b.height)) + 'px';
  }
  if (window.matchMedia('(hover: hover)').matches) {
    document.addEventListener('mouseover', e => {
      const el = tipTarget(e.target);
      if (el === tipEl) return;
      tipHide();
      if (!el) return;
      tipEl = el;
      tipTimer = setTimeout(() => { if (tipEl === el && el.isConnected) tipShow(el); }, 350);
    });
    ['mousedown', 'keydown', 'scroll', 'hashchange'].forEach(ev => window.addEventListener(ev, tipHide, true));
  }

  document.addEventListener('click', async e => {
    const el = e.target.closest('[data-act]');
    if (!el || el.tagName === 'SELECT' || (el.type === 'file')) return;
    const act = el.dataset.act;
    ensureAudio();
    switch (act) {
      case 'cat': listFilter.cat = el.dataset.v; $$('#cats .chip').forEach(c => c.classList.toggle('on', c === el)); updateList(); break;
      case 'seed': seed(); break;
      case 'mult': setMult(+el.dataset.v); { const mi = $('#mult'); if (mi) mi.value = multText(vs(route.id).mult); } break;
      case 'check': { const s = vs(route.id).checked; el.checked ? s.add(el.dataset.i) : s.delete(el.dataset.i); el.closest('tr').classList.toggle('done', el.checked); break; }
      case 'plan-check': el.closest('tr').classList.toggle('done', el.checked); break;
      case 'uncheck': vs(route.id).checked.clear(); updateRecipeComputed(); break;
      case 'anchor': anchorIngredient(el.dataset.i); break;
      case 'stepdone': {
        if (e.target.closest('button')) break;
        const s = vs(route.id).stepsDone, id = el.dataset.s;
        s.has(id) ? s.delete(id) : s.add(id);
        el.classList.toggle('done', s.has(id));
        break;
      }
      case 'timer': {
        const r = getRecipe(route.id), k = r.steps.findIndex(s => s.id === el.dataset.s), s = r.steps[k];
        startTimer(`${r.name}｜步驟 ${k + 1}：${s.text.slice(0, 24)}`, s.minutes * 60);
        break;
      }
      case 't-x': case 't-pause': case 't-add': timerAction(act, el.dataset.t); break;
      case 'wake': toggleWake(el); break;
      case 'print': flush(); window.print(); break;
      case 'addplan': {
        const id = el.dataset.id, mult = vs(id).mult;
        const p = db.plan.find(x => x.recipeId === id);
        if (p) p.mult = mult; else db.plan.push({ recipeId: id, mult });
        persist();
        toast(`已加入備料單（× ${multText(mult)}）`);
        break;
      }
      case 'dup': {
        const r = getRecipe(el.dataset.id);
        const c = normRecipe({ ...clone(r), id: uid(), name: r.name + '（複本）', createdAt: Date.now(), updatedAt: Date.now(),
          ingredients: r.ingredients.map(i => ({ ...i, id: uid() })), steps: r.steps.map(s => ({ ...s, id: uid() })) });
        db.recipes.push(c); persist(true);
        location.hash = '#/edit/' + encodeURIComponent(c.id);
        break;
      }
      // 編輯
      case 'cancel-edit': {
        const back = draft && !draft.isNew ? '#/r/' + encodeURIComponent(draft.key) : '#/';
        if (draft && draft.dirty && !(await confirmBox('放棄變更', '確定要放棄尚未儲存的變更嗎？', '放棄', true))) break;
        draft = null; location.hash = back; break;
      }
      case 'save-recipe': saveDraft(); break;
      case 'add-head': {
        const arr = draft.r.ingredients;
        arr.push({ ...blankIng(arr.length ? arr[arr.length - 1].group : ''), _head: true });
        draft.dirty = true;
        rerenderEdit(`[data-bind="ingredients.${arr.length - 1}.name"]`);
        break;
      }
      case 'add': {
        const list = el.dataset.list, arr = draft.r[list];
        arr.push(list === 'ingredients' ? blankIng(arr.length ? arr[arr.length - 1].group : '') : blankStep());
        draft.dirty = true;
        rerenderEdit(list === 'ingredients' ? `[data-bind="ingredients.${arr.length - 1}.name"]` : `[data-bind="steps.${arr.length - 1}.text"]`);
        break;
      }
      case 'rm': draft.r[el.dataset.list].splice(+el.dataset.k, 1); draft.dirty = true; rerenderEdit(); break;
      case 'mv': {
        const arr = draft.r[el.dataset.list], k = +el.dataset.k, j = k + +el.dataset.d;
        if (j < 0 || j >= arr.length) break;
        [arr[k], arr[j]] = [arr[j], arr[k]]; draft.dirty = true; rerenderEdit(); break;
      }
      case 'bulk': bulkPaste(el.dataset.list); break;
      case 'photo-rm': draft.r.photo = ''; draft.dirty = true; rerenderEdit(); break;
      case 'delete-recipe': {
        const r = getRecipe(draft.key);
        if (!(await confirmBox('刪除食譜', `確定要刪除「${esc(r.name)}」嗎？此動作無法復原。`, '刪除', true))) break;
        db.recipes = db.recipes.filter(x => x.id !== r.id);
        db.plan = db.plan.filter(p => p.recipeId !== r.id);
        db.deleted[r.id] = Date.now();
        persist(true); draft = null; location.hash = '#/'; toast('已刪除');
        break;
      }
      // 備料單
      case 'plan-add': {
        const id = $('#planAdd').value;
        if (!db.plan.some(p => p.recipeId === id)) db.plan.push({ recipeId: id, mult: 1 });
        persist(); render(); break;
      }
      case 'plan-rm': db.plan.splice(+el.dataset.k, 1); persist(); render(); break;
      case 'tr-draft': translateDraft(); break;
      case 'ring-test': ensureAudio(); stopRing(); playRing(el.dataset.tone, 5); break;
      case 'ring-file-rm':
        try { localStorage.removeItem(RING_FILE_KEY); } catch (e) { /* ignore */ }
        if (db.settings.ringTone === 'custom') { db.settings.ringTone = 'beep'; persist(); }
        render(); toast('已移除自訂音檔'); break;
      // 小抄
      case 'cheat-from-recipe': cheatAddRecipe(el.dataset.id, vs(el.dataset.id).mult); persist(); location.hash = '#/cheat'; break;
      case 'cheat-from-plan': db.plan.forEach(p => cheatAddRecipe(p.recipeId, p.mult)); persist(); if (route.name === 'cheat') refreshCheat(); else location.hash = '#/cheat'; break;
      case 'cheat-edit': openCheatEditor(); break;
      case 'kbd-help': showShortcuts(); break;
      // SOP 主資料
      case 'sop-new': {
        const o = normSop({ rows: Array.from({ length: 5 }, () => ({})) });
        db.sops.push(o); persist(); location.hash = '#/sop/' + encodeURIComponent(o.id);
        setTimeout(() => { const t = $('[data-sop="title"]'); if (t) t.focus(); }, 50);
        break;
      }
      case 'sop-row-add': {
        const o = getSop(route.id), last = o.rows[o.rows.length - 1];
        o.rows.push(normSopRow({ unit: last ? last.unit : '公克', specUnit: last ? last.specUnit : '公克', loss: last ? last.loss : '' }));
        sopTouch(o); render();
        const ins = $$('[data-sop-row$=".name"]'); if (ins.length) ins[ins.length - 1].focus();
        break;
      }
      case 'sop-row-rm': { const o = getSop(route.id); o.rows.splice(+el.dataset.k, 1); sopTouch(o); render(); break; }
      case 'sop-row-mv': {
        const o = getSop(route.id), k = +el.dataset.k, j = k + +el.dataset.d;
        if (j >= 0 && j < o.rows.length) { [o.rows[k], o.rows[j]] = [o.rows[j], o.rows[k]]; sopTouch(o); render(); }
        break;
      }
      case 'sop-from-recipe': sopFromRecipe(getSop(route.id)); break;
      case 'sop-print': { const o = getSop(route.id); if (IS_MOBILE) sharePdf(() => buildSopPdf(o)); else { updateSopCalc(); flush(); window.print(); } break; }
      case 'sop-dup': {
        const o = getSop(route.id);
        const c = normSop({ ...clone(o), id: uid(), title: o.title + '（複本）', rows: o.rows.map(x => ({ ...x, id: uid() })), createdAt: Date.now(), updatedAt: Date.now() });
        db.sops.push(c); persist(); location.hash = '#/sop/' + encodeURIComponent(c.id); toast('已複製');
        break;
      }
      case 'sop-del': {
        const o = getSop(route.id);
        if (!(await confirmBox('刪除 SOP', `確定要刪除「${esc(o.title || '未命名 SOP')}」嗎？此動作無法復原。`, '刪除', true))) break;
        db.sops = db.sops.filter(x => x.id !== o.id); db.deleted[o.id] = Date.now();
        persist(true); location.hash = '#/sops'; toast('已刪除');
        break;
      }
      case 'inv-week': { const d = +el.dataset.d; invWeek = d ? ymd(invDate(invWeek, d * 7)) : weekOf(new Date()); render(); break; }
      case 'inv-day': invDay = +el.dataset.v; try { localStorage.setItem('ksop.invDay', String(invDay)); } catch (e) { /* 無法存取 */ } render(); break;
      case 'inv-items': invEditItems(); break;
      case 'inv-print': {
        if (IS_MOBILE) sharePdf(() => buildInvPdf(invWeek));
        else { $('#invPrint').innerHTML = invPrintHtml(invWeek); flush(); window.print(); }
        break;
      }
      case 'inv-copy': {
        const t = invOrderText(invWeek, invDayNow());
        if (!t) { toast('這天還沒有填訂貨量'); break; }
        try { await navigator.clipboard.writeText(t); toast('已複製訂貨單，可以貼到 LINE'); }
        catch (e) { modal({ title: '訂貨單', body: `<textarea rows="12" style="width:100%" readonly>${esc(t)}</textarea>`, buttons: [{ label: '關閉', cls: 'primary', value: null }] }); }
        break;
      }
      case 'sop-photo-rm': { const o = getSop(route.id); o.photo = ''; sopTouch(o); render(); break; }
      case 'cheat-close': closeCheatEditor(); break;
      case 'cheat-note': cheatCfg().items.push({ type: 'note', title: '', text: '' }); persist(); refreshCheat(true); break;
      case 'cheat-rm': {
        const a = cheatCfg().items, k = +el.dataset.k;
        if (a[k].type === 'note') a.splice(k, 1); else a[k].off = true;
        persist(); refreshCheat(); break;
      }
      case 'cheat-show': delete cheatCfg().items[+el.dataset.k].off; persist(); refreshCheat(); break;
      case 'cheat-mv': {
        const a = cheatCfg().items, k = +el.dataset.k, j = k + +el.dataset.d;
        if (j >= 0 && j < a.length) { [a[k], a[j]] = [a[j], a[k]]; persist(); refreshCheat(); }
        break;
      }
      case 'cheat-print': if (IS_MOBILE) cheatPdf(); else { flush(); window.print(); } break;
      case 'cheat-clear': if (await confirmBox('清空小抄', '食譜卡片會全部隱藏，文字卡會刪除。食譜不會被刪除，之後可以在「編輯卡片」重新顯示。', '清空', true)) { const c = cheatCfg(); c.items = c.items.filter(x => x.type !== 'note'); c.items.forEach(x => { x.off = true; }); persist(); refreshCheat(); } break;
      case 'plan-clear': if (await confirmBox('清空備料單', '確定要清空備料單嗎？（食譜不會被刪除）', '清空', true)) { db.plan = []; persist(); render(); } break;
      // 單價
      case 'label-connect':
        try { await labelConnect(el.dataset.via); } catch (e) { if (e.name !== 'NotFoundError') toast('連線失敗：' + e.message, 'err'); }
        break;
      case 'label-disconnect': await labelDisconnect(); break;
      case 'label-print': await labelPrint(); break;
      case 'label-png': await labelPng(); break;
      case 'label-save': await labelSave(); break;
      case 'label-load': labelLoad(el.dataset.id); window.scrollTo(0, 0); break;
      case 'label-rm': {
        const c = labelCfg(), x = c.saved.find(y => y.id === el.dataset.id);
        if (x && await confirmBox('刪除標籤', `確定要刪除「${x.name}」嗎？`, '刪除', true)) { c.saved = c.saved.filter(y => y !== x); db.deleted[x.id] = Date.now(); persist(); render(); }
        break;
      }
      case 'label-sys': await labelSys(); break;
      case 'label-a4': await labelA4(); break;
      case 'label-browser': await labelBrowser(); break;
      case 'price-add': priceFilter = ''; db.prices.push(normPrice({})); db.pricesUpdatedAt = Date.now(); persist(); render(); { const ins = $$('[data-price$=".name"]'); ins.length && ins[ins.length - 1].focus(); } break;
      case 'price-rm': db.prices.splice(+el.dataset.k, 1); db.pricesUpdatedAt = Date.now(); persist(); render(); break;
      case 'price-import': {
        const have = new Set(db.prices.map(p => normName(p.name)));
        let n = 0;
        for (const r of db.recipes) for (const i of r.ingredients) {
          const k = normName(i.name);
          if (k && !isHead(i) && !have.has(k)) { have.add(k); db.prices.push(normPrice({ name: i.name.trim(), perQty: 1, perUnit: U.lookup(i.unit) ? (U.lookup(i.unit).dim === 'mass' ? 'kg' : 'L') : i.unit })); n++; }
        }
        if (n) db.pricesUpdatedAt = Date.now();
        persist(); render(); toast(n ? `已帶入 ${n} 項食材，請填寫價格` : '所有食材都已在單價表中');
        break;
      }
      // 雲端
      case 'cloud-connect': cloudConnect(); break;
      case 'cloud-sync': case 'cloud-pill':
        if (act === 'cloud-pill' && cloudState.s === 'err' && route.name !== 'settings') { location.hash = '#/settings'; break; }
        await cloudSync();
        if (cloudState.s === 'err') toast('同步失敗：' + cloudState.msg, 'err');
        break;
      case 'cloud-off':
        if (await confirmBox('中斷雲端連線', '這台裝置將不再與 Google 試算表同步（雲端與本機的資料都會保留）。', '中斷連線', true)) {
          db.cloud = null; db.sync = { rev: 0, dirty: false, photos: [] }; saveLocal(true); setSync('off'); render();
        }
        break;
      // 設定
      case 'export': exportData(); break;
      case 'wipe': {
        const v = await modal({ title: '清除全部資料', body: '<p>將刪除所有食譜、單價與備料單，<b>無法復原</b>。建議先匯出備份。</p><p>請輸入「清除」確認：</p><input id="wipeOk">',
          buttons: [{ label: '取消', value: null }, { label: '清除全部', cls: 'danger', value: m => m.querySelector('#wipeOk').value.trim() }] });
        if (v === '清除') {
          const now = Date.now(), keep = { cloud: db.cloud, sync: db.sync, deleted: db.deleted };
          db.recipes.forEach(r => { keep.deleted[r.id] = now; });
          db = { ...emptyDb(), ...keep, pricesUpdatedAt: now };
          persist(true); render(); toast('已清除全部資料');
        } else if (v != null) toast('輸入不符，未清除');
        break;
      }
    }
  });

  // Windows 版：點進輸入框時自動切換輸入法——文字欄用中文，數字欄用英數（注音模式下數字鍵會打出注音）
  function imeMode(t) {
    if (!t || !/^(INPUT|TEXTAREA)$/.test(t.tagName) || t.readOnly || t.disabled) return '';
    const type = (t.type || 'text').toLowerCase();
    if (t.tagName === 'INPUT' && !/^(text|search|number|url|password)$/.test(type)) return '';
    if (t.lang === 'vi' || t.dataset.ime === 'none') return '';
    if (t.dataset.ime === 'en') return 'en';                  // 越南文欄位：不干涉
    if (/^(number|url|password)$/.test(type) || /^(decimal|numeric)$/.test(t.inputMode)) return 'en';
    if (t.id === 'mult' || t.id === 'target' || t.id === 'cloudUrl' || t.dataset.cheatMult != null || t.dataset.plan != null || t.dataset.inv != null) return 'en'; // 品號、數量
    if (/\.unit$/.test(t.dataset.bind || '') || /\.perUnit$/.test(t.dataset.price || '') || t.id === 'anchorVal') return ''; // 單位、量：中英都有
    return 'zh';
  }
  if (IS_DESKTOP) {
    document.addEventListener('focusin', e => {
      const m = imeMode(e.target);
      if (m) desktopApi().then(a => a.set_ime && a.set_ime(m)).catch(() => {});
    });
  }

  // 中文輸入法（注音、倉頡…）選字中不處理，選好字（compositionend）後再處理；
  // 否則重畫畫面或寫入半成品的注音符號會打斷輸入法
  document.addEventListener('input', e => { if (!e.isComposing) onInput(e.target); });
  document.addEventListener('compositionend', e => onInput(e.target));

  function onInput(t) {
    if (t.id === 'sopq') { sopFilter = t.value; updateSopList(); return; }
    if (t.dataset.inv && route.name === 'inv') {
      const [id, k] = t.dataset.inv.split('.');
      if (k === 'c') { const x = db.inv.items.find(y => y.id === id); if (x) { x.code = t.value.trim(); db.inv.itemsAt = Date.now(); persist(); } }
      else invSet(id, +k, t.value);
      return;
    }
    if ((t.dataset.sop || t.dataset.sopRow) && route.name === 'sop') {
      const o = getSop(route.id);
      if (!o) return;
      if (t.dataset.sopRow) { const [k, f] = t.dataset.sopRow.split('.'); if (o.rows[+k]) o.rows[+k][f] = t.value; }
      else {
        const f = t.dataset.sop;
        if (t.type === 'radio') { if (t.checked) o.review.result = t.value; }
        else if (f.startsWith('review.')) o.review[f.slice(7)] = t.value;
        else o[f] = t.value;
        // 淨售價、含稅售價互算（5% 營業稅）
        if (f === 'net' || f === 'gross') {
          const v = sopNum(t.value), other = f === 'net' ? 'gross' : 'net';
          o[other] = v == null ? '' : String(Math.round((f === 'net' ? v * (1 + TAX) : v / (1 + TAX)) * 100) / 100);
          const oi = $(`[data-sop="${other}"]`); if (oi && oi !== document.activeElement) oi.value = o[other];
        }
      }
      sopTouch(o); updateSopCalc();
      return;
    }
    if (t.id === 'q') { listFilter.q = t.value; updateList(); return; }
    if (t.id === 'pq') { priceFilter = t.value; const pos = t.selectionStart; render(); const n = $('#pq'); n.focus(); n.setSelectionRange(pos, pos); return; }
    if (t.id === 'mult') { const m = parseMult(t.value); if (m) setMult(m); return; }
    if (t.id === 'target') { const r = getRecipe(route.id), v = num(t.value); if (r && v > 0) setMult(v / r.yieldQty); return; }
    if (t.dataset.bind && draft) {
      const b = t.dataset.bind;
      setPath(draft.r, b, t.type === 'checkbox' ? t.checked : t.value);
      if (/Vi$/.test(b)) draft.viTouched.add(b);
      else if (/(^|\.)(name|category|notes|group|note|text)$/.test(b) && !draft.viTouched.has(b + 'Vi')) {
        // 中文改了：清掉舊的越南文，儲存時重新翻譯
        setPath(draft.r, b + 'Vi', '');
        const v = $(`[data-bind="${b}Vi"]`);
        if (v) v.value = '';
      }
      draft.dirty = true;
      t.classList.remove('invalid');
      return;
    }
    if (t.dataset.cheatMult != null) {
      const k = +t.dataset.cheatMult, m = parseMult(t.value), it = cheatCfg().items[k];
      if (it && m) { it.mult = m; persist(); const r = getRecipe(it.recipeId); $('#cy' + k).textContent = `${fmt(r.yieldQty * m)} ${r.yieldUnit}`; updateCheat(); }
      return;
    }
    if (t.dataset.label) { onLabelInput(t); return; }
    if (t.id === 'labelQ') { labelQ = t.value; $('#labelList').innerHTML = labelSavedHtml(); return; }
    if (t.dataset.cheatSteps != null) {
      const it = cheatCfg().items[+t.dataset.cheatSteps], r = it && getRecipe(it.recipeId);
      if (r) { cheatSetSteps(r, t.value); persist(); updateCheat(); }
      return;
    }
    if (t.dataset.cheatNote != null) {
      const it = cheatCfg().items[+t.dataset.cheatNote];
      if (it) { it[t.dataset.f] = t.value; it[t.dataset.f + 'Vi'] = ''; persist(); updateCheat(); }
      return;
    }
    if (t.dataset.plan != null) {
      const k = +t.dataset.plan, m = parseMult(t.value), p = db.plan[k];
      if (p && m > 0) { p.mult = m; persist(); const r = getRecipe(p.recipeId); $('#py' + k).textContent = `${fmt(r.yieldQty * m)} ${r.yieldUnit}`; updatePlanTotal(); }
      return;
    }
    if (t.dataset.price) {
      const [k, f] = t.dataset.price.split('.'), p = db.prices[+k];
      if (!p) return;
      if (f === 'price' || f === 'perQty') { const v = num(t.value); if (t.value.trim() && v == null) { t.classList.add('invalid'); return; } t.classList.remove('invalid'); p[f] = f === 'perQty' ? v || 1 : v; }
      else p[f] = t.value;
      db.pricesUpdatedAt = Date.now();
      persist();
      const up = $('#up' + k); if (up) up.innerHTML = unitPriceText(p);
    }
  }

  document.addEventListener('change', async e => {
    const t = e.target, act = t.dataset.actChange;
    if (t.dataset.sopRow && /\.name$/.test(t.dataset.sopRow) && route.name === 'sop') {
      const o = getSop(route.id), x = o && o.rows[+t.dataset.sopRow.split('.')[0]];
      if (x && sopFillFromPrice(x)) {
        const k = t.dataset.sopRow.split('.')[0];
        for (const f of ['specQty', 'specUnit', 'price']) { const el = $(`[data-sop-row="${k}.${f}"]`); if (el) el.value = x[f]; }
        sopTouch(o); updateSopCalc(); toast('已從單價表帶入規格與進價');
      }
      return;
    }
    if ((act === 'sop-ocr' || act === 'sop-ocr-new') && t.files[0]) {
      const file = t.files[0];
      t.value = '';
      let o = act === 'sop-ocr' ? getSop(route.id) : null;
      if (!o) { o = normSop({}); db.sops.push(o); persist(); location.hash = '#/sop/' + encodeURIComponent(o.id); }
      sopOcr(o, file);
      return;
    }
    if (act === 'sop-photo' && t.files[0]) {
      const o = getSop(route.id);
      try { o.photo = await resizeImage(t.files[0]); sopTouch(o); render(); } catch (err) { toast(err.message, 'err'); }
      return;
    }
    if (t.dataset.cheatOpt) {
      cheatCfg()[t.dataset.cheatOpt] = t.type === 'checkbox' ? t.checked : t.value;
      persist(); updateCheat(); return;
    }
    if (!act) return;
    if (act === 'unitmode') {
      db.settings.unitMode = t.value; persist();
      $$('[data-act-change="unitmode"]').forEach(s => { s.value = t.value; });
      updateRecipeComputed(); updatePlanTotal(); updateCheat();
    } else if (act === 'photo' && t.files[0]) {
      try { draft.r.photo = await resizeImage(t.files[0]); draft.dirty = true; rerenderEdit(); } catch (err) { toast(err.message, 'err'); }
    } else if (act === 'ring-tone') {
      db.settings.ringTone = t.value; persist();
      ensureAudio(); stopRing(); playRing(t.value, 5);
    } else if (act === 'ring-vol') {
      db.settings.ringVol = +t.value; persist();
      $('#ringVolTxt').textContent = Math.round(+t.value * 100) + '%';
      ensureAudio(); stopRing(); playRing(currentTone(), 3);
    } else if (act === 'ring-file' && t.files[0]) {
      const file = t.files[0];
      t.value = '';
      if (file.size > 3 * 1024 * 1024) return toast('音檔太大，請用 3 MB 以內的檔案', 'err');
      const data = await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => res(null); r.readAsDataURL(file); });
      ensureAudio();
      try {
        const bin = atob(String(data).split(',')[1]), bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        await new Promise((res, rej) => audioCtx.decodeAudioData(bytes.buffer, res, rej));
      } catch (e) { return toast('無法播放這個音檔，請改用 mp3、m4a 或 wav', 'err'); }
      try { localStorage.setItem(RING_FILE_KEY, JSON.stringify({ name: file.name, data })); }
      catch (e) { return toast('裝置空間不足，無法儲存音檔', 'err'); }
      db.settings.ringTone = 'custom'; persist();
      render(); toast('已設定自訂鈴聲');
      playRing('custom', 5);
    } else if (act === 'import' && t.files[0]) {
      await importData(t.files[0]); t.value = '';
    }
  });

  window.addEventListener('beforeunload', e => { flush(); if (draft && draft.dirty) { e.preventDefault(); e.returnValue = ''; } });
  document.addEventListener('visibilitychange', async () => {
    if (!document.hidden && wakeLock === null && $('[data-act="wake"].on')) { try { wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { /* ignore */ } }
    if (!document.hidden) { tick(); if (db && db.cloud) cloudSync(); checkUpdate(); }
    else flush();
  });

  // 主畫面 App 從背景切回來時不會重新載入：發現網站已發佈新版就自動重新整理（編輯中不打斷）
  let lastUpdateCheck = 0;
  async function checkUpdate() {
    if (IS_DESKTOP || !/^https?:$/.test(location.protocol) || Date.now() - lastUpdateCheck < 60000) return;
    lastUpdateCheck = Date.now();
    try {
      const html = await (await fetch('index.html?_=' + Date.now(), { cache: 'no-store' })).text();
      const latest = (html.match(/app\.js\?v=(\d+)/) || [])[1];
      const cur = ((($('script[src^="app.js"]') || {}).src || '').match(/v=(\d+)/) || [])[1];
      if (!latest || !cur || latest === cur || (draft && draft.dirty)) return;
      // 同一個新版只自動重新載入一次，避免拿到舊快取時不停重整
      let tried = '';
      try { tried = sessionStorage.getItem('ksop.updateTo') || ''; sessionStorage.setItem('ksop.updateTo', latest); } catch (e) { /* ignore */ }
      if (tried === latest) return;
      flush();
      // 網址加上版本參數，避開瀏覽器對首頁的快取
      const u = new URL(location.href);
      u.searchParams.set('v', latest);
      location.replace(u.toString());
    } catch (e) { /* 離線時略過 */ }
  }

  // ---------------------------------------------------------------- 啟動
  async function init() {
    let d = null;
    try { d = await Store.load(); }
    catch (e) { loadFailed = true; console.error(e); toast('讀取資料失敗：' + e.message, 'err'); }
    if (d) db = normalizeDb(d);
    else {
      db = emptyDb();
      if (!loadFailed) { const s = sampleData(); db.recipes = s.recipes; db.prices = s.prices; db.pristine = true; saveLocal(true); }
    }
    window.addEventListener('hashchange', onHash);
    render();
    if (db.cloud) cloudSync();
    setInterval(() => { if (!document.hidden && db.cloud && !cloudBusy) cloudSync(); }, LIVE_POLL_MS);
    window.addEventListener('online', () => { if (db.cloud) cloudSync(); });
    document.body.classList.add('ready');
    if (!IS_DESKTOP && 'serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(() => {});
    setTimeout(checkUpdate, 3000);
    if (!IS_DESKTOP && navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  }

  // 供桌面版自我測試使用
  window.__kitchenOcr = t => ocrCheck(parseOcrText(t), '');
  window.__kitchen = { get db() { return db; }, persist, U, version: APP_VERSION, labelSend, mergeLabels, labelA4Pdf };
  init();
})();
