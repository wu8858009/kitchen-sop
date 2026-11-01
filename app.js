/* 廚房 SOP 食譜及倍數計算系統 */
(() => {
  'use strict';
  const U = window.KUnits;
  const APP_VERSION = '2.4.0';
  const IS_DESKTOP = /[?&]desktop=1\b/.test(location.search);

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const escML = s => esc(s).replace(/\n/g, '<br>');
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const clone = o => JSON.parse(JSON.stringify(o));
  const normName = s => String(s || '').trim().toLowerCase().replace(/\s+/g, '');
  // 越南文只用在小抄卡片：中文下方加一行越南文（食譜內容用翻譯好的欄位，固定字用字典）
  const viOn = () => cheatCfg().vi !== false;
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
    return { version: 1, recipes: [], prices: [], sops: [], plan: [], settings: { unitMode: 'auto', ringTone: 'beep', ringVol: 0.8 }, deleted: {}, pricesUpdatedAt: 0, cloud: null, sync: { rev: 0, dirty: false, photos: [] } };
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
      case 'prices': app.innerHTML = viewPrices(); break;
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

      <section class="card">
        <div class="sec-head"><h2>食材</h2><span class="muted small" id="ingSub"></span>
          <div class="spacer"></div><button class="btn sm no-print" data-act="uncheck">清除勾選</button></div>
        <div id="ing"></div>
        <div id="costBox" class="cost-box"></div>
      </section>

      <section class="card">
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

  // ---------------------------------------------------------------- 小抄
  // 存在 settings.cheat，跟著設定一起同步到雲端
  const CHEAT_DEF = { items: [], ing: true, steps: 'key', notes: true, cost: false, vi: true, layout: 'two', size: 'm' };
  function cheatCfg() {
    const c = Object.assign({}, CHEAT_DEF, db.settings.cheat || {});
    c.items = (Array.isArray(c.items) ? c.items : []).filter(x => x && (x.type === 'note' || getRecipe(x.recipeId)));
    return (db.settings.cheat = c);
  }
  function cheatAddRecipe(id, mult) {
    const c = cheatCfg(), it = c.items.find(x => x.type !== 'note' && x.recipeId === id);
    if (it) it.mult = mult; else c.items.push({ type: 'recipe', recipeId: id, mult });
  }

  // 卡片清單（在「編輯卡片」彈跳視窗裡）
  function cheatItemsHtml() {
    const c = cheatCfg();
    return c.items.map((it, k) => {
      const tools = `<button class="icon" data-act="cheat-mv" data-k="${k}" data-d="-1" title="上移">↑</button><button class="icon" data-act="cheat-mv" data-k="${k}" data-d="1" title="下移">↓</button>
        <button class="icon danger" data-act="cheat-rm" data-k="${k}" title="移除">✕</button>`;
      if (it.type === 'note') return `<div class="cheat-item note">
        <div class="ci-row">${DRAG}<input type="text" placeholder="卡片標題（例如：出餐順序、注意事項）" data-cheat-note="${k}" data-f="title" value="${esc(it.title || '')}">${tools}</div>
        <textarea rows="3" placeholder="內容，一行一點" data-cheat-note="${k}" data-f="text">${esc(it.text || '')}</textarea></div>`;
      const r = getRecipe(it.recipeId);
      return `<div class="cheat-item"><div class="ci-row">${DRAG}<span class="pname">${esc(r.name)}</span>
        <label class="inline">×<input type="text" autocomplete="off" placeholder="2 或 /3" data-cheat-mult="${k}" value="${multText(it.mult)}"></label>
        <span class="muted small" id="cy${k}">${fmt(r.yieldQty * it.mult)} ${esc(r.yieldUnit)}</span>${tools}</div></div>`;
    }).join('') || '<p class="muted">尚未加入卡片。</p>';
  }

  function openCheatEditor() {
    const avail = [...db.recipes].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
    const m = $('#modal');
    m.innerHTML = `<div class="modal-back" data-cheat-back><div class="modal cheat-modal" id="cheatEditor" role="dialog" aria-modal="true">
        <div class="cm-head"><h3>編輯小抄卡片</h3><div class="spacer"></div><button class="icon" data-act="cheat-close" title="關閉">✕</button></div>
        <p class="hint">把食譜依倍數濃縮成精簡卡片（份量、食材用量、重點步驟），列印後可剪下貼在工作台；也能加自訂文字卡。按住 ⠿ 拖曳可以調整順序。</p>
        <div class="cm-scroll"><div class="cheat-items" id="cheatItems"></div></div>
        <div class="plan-add cm-add">
          ${avail.length ? `<select id="cheatAdd">${avail.map(r => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('')}</select>
          <button class="btn primary" data-act="cheat-add">＋ 食譜</button>` : ''}
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
    const c = cheatCfg();
    const opt = (k, v, t) => `<option value="${v}" ${c[k] === v ? 'selected' : ''}>${t}</option>`;
    const box = (k, t) => `<label class="ck-lbl"><input type="checkbox" data-cheat-opt="${k}" ${c[k] ? 'checked' : ''}> ${t}</label>`;
    return `<div class="page cheat-page">
      <div class="page-head no-print"><h1 class="head-title">小抄</h1><div class="spacer"></div>
        <button class="btn" data-act="cheat-edit">📋 編輯卡片（${c.items.length}）</button>
        ${c.items.length ? '<button class="btn primary" data-act="cheat-print">🖨 列印小抄</button><button class="btn ghost" data-act="cheat-clear">清空</button>' : ''}</div>
      ${c.items.length ? '' : `<div class="empty no-print"><p>還沒有小抄卡片。</p><button class="btn primary" data-act="cheat-edit">＋ 加入卡片</button></div>`}
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
      const a = cheatCfg().items, [x] = a.splice(from, 1);
      a.splice(to, 0, x);
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
    const steps = c.steps === 'none' ? [] : r.steps.map((s, k) => ({ ...s, n: k + 1 })).filter(s => c.steps === 'all' || s.key);
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
    host.innerHTML = c.items.map(it => cheatCard(it, c)).join('');
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
    if (!cheatCfg().items.length) return toast('請先加入卡片');
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
    el.innerHTML = c.items.map(it => cheatCard(it, c)).join('');
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

  // Google 的 OCR 常把表格「一欄一欄」讀出來（品名、數量、廠商分在不同行）：改依出現順序配對——
  // 品名後面的數字是使用份量；單位後面的字是廠商；其他「數量＋單位」是規格；% 是耗損；200.00 這種採購份量會自動算，略過
  function parseOcrStream(lines) {
    const toks = [];
    lines.forEach((raw, ln) => {
      const str = ocrHalf(raw).replace(/[|｜□口]/g, ' ').replace(/(\d)\s*%/g, '$1% ')
        .replace(new RegExp('(\\d)\\s*(' + OCR_UNITS + ')(?![A-Za-z])', 'gi'), '$1 $2 ');
      str.split(/\s+/).filter(Boolean).forEach(t => toks.push({ t, ln }));
    });
    const items = [], vendors = [], specs = [], prices = [], losses = [], buys = [];
    const isUnit = t => OCR_UNIT_RE.test(t || '');
    let cur = null, afterUnit = false, loneUnit = '', nameLine = -1;
    for (let i = 0; i < toks.length; i++) {
      const { t, ln } = toks[i], next = (toks[i + 1] || {}).t;
      if (/^\d+(\.\d+)?%$/.test(t)) { losses.push(t.slice(0, -1)); afterUnit = false; loneUnit = ''; continue; }
      if (ocrNum(t)) {
        const n = t.replace(/,/g, '');
        if (isUnit(next)) {
          i++;
          afterUnit = true; loneUnit = '';
          if (/\.\d\d$/.test(n)) { buys.push(n); continue; } // 採購份量：拿來核對
          if (cur && !cur.qty) { cur.qty = n; cur.unit = next; } else specs.push([n, next]);
          continue;
        }
        if (cur && !cur.qty) cur.qty = n;
        else if (loneUnit) specs.push([n, loneUnit]);       // 「公克 1000」
        else if (!(/^\d+$/.test(n) && +n <= 60)) prices.push(n); // 60 以下的整數多半是列號 NO
        afterUnit = false; loneUnit = '';
        continue;
      }
      if (isUnit(t)) { afterUnit = true; loneUnit = t; continue; }
      loneUnit = '';
      if (OCR_HEAD_RE.test(t) || !/[\u3400-\u9fffA-Za-z]/.test(t)) { afterUnit = false; continue; }
      if (afterUnit) { vendors.push(t); afterUnit = false; continue; }
      if (cur && !cur.qty && nameLine === ln) cur.name += ' ' + t;   // 同一行的品名接起來（例如「M9 澳洲和牛…」）
      else { cur = { name: t, qty: '', unit: '' }; items.push(cur); nameLine = ln; }
    }
    return items.filter(it => it.qty).map((it, k) => {
      const sp = specs[k] || [];
      const unit = fixUnit(it.unit || sp[1] || '公克');
      return { name: it.name, qty: it.qty, unit, vendor: vendors[k] || '', specQty: sp[0] || '', specUnit: fixUnit(sp[1] || unit), price: prices[k] || '', loss: losses[k] || '', buy: buys[k] || '' };
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
      else if (mode === 'steps' || mode === 'notes') {
        const t = line.replace(/^\d{1,2}[.、)\s]+/, '').trim();
        if (/[\u3400-\u9fff]/.test(t) && !/^\d+$/.test(t)) out[mode].push(t);
      }
    }
    // 一行一項的寫法用逐行解析；讀不出來（表格被拆成一欄一欄）就改用順序配對，取讀到較多項的
    const stream = parseOcrStream(tableLines);
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

  async function sopOcr(o, file) {
    if (!db.cloud) return toast('照片辨識需要先在「設定」連線 Google 雲端', 'err');
    toast('照片辨識中…（約 10～30 秒）');
    let text, img;
    try {
      img = await resizeImage(file, 2400);
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
            ${parsed.steps.length || parsed.notes.length ? `<p class="small muted">另外讀到操作步驟 ${parsed.steps.length} 行、注意事項 ${parsed.notes.length} 行，會一起填入。</p>` : ''}
            <details class="ocr-raw"><summary>辨識出的原始文字</summary>
              <textarea id="ocrText" rows="12" spellcheck="false">${esc(text)}</textarea>
              <button class="btn sm" id="ocrReparse">重新判讀（會取代上面表格）</button></details>
          </div></div>`,
      buttons: [{ label: '取消', value: null }, { label: '填入', cls: 'primary', value: () => parsed }],
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
    ['Alt+5', '切到「單價表」', '', () => go('#/prices')],
    ['Alt+6', '切到「設定」', '', () => go('#/settings')],
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
  const PAGE_NAMES = { '': '全部頁面', r: '食譜頁', edit: '編輯食譜', sop: 'SOP 表單', sops: 'SOP 列表', plan: '備料單', cheat: '小抄', prices: '單價表', settings: '設定' };

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
    return `<div class="page">
      <div class="page-head"><h1 class="head-title">設定與資料</h1><div class="spacer"></div>
        ${IS_MOBILE ? '' : '<button class="btn" data-act="kbd-help">⌨ 快捷鍵（F1）</button>'}</div>
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
      ...local, recipes, sops, deleted,
      prices: localPrices ? local.prices : remote.prices,
      pricesUpdatedAt: Math.max(local.pricesUpdatedAt, remote.pricesUpdatedAt),
    };
  }

  function applyRemote(L, merge) {
    const remote = normalizeDb(L.db);
    if (!Array.isArray(L.db && L.db.sops)) remote.sops = db.sops; // 舊版後端沒有 SOP：保留本機的
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
      if (info.rev > 0 && info.recipes > 0) {
        mode = db.recipes.length && !db.pristine ? await modal({
          title: '雲端已有資料',
          body: `<p>雲端有 ${info.recipes} 道食譜，這台裝置有 ${db.recipes.length} 道。要怎麼處理？</p>
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
      case 'sop-photo-rm': { const o = getSop(route.id); o.photo = ''; sopTouch(o); render(); break; }
      case 'cheat-close': closeCheatEditor(); break;
      case 'cheat-add': {
        const id = $('#cheatAdd').value;
        if (cheatCfg().items.some(x => x.recipeId === id)) { toast('這道菜已經在小抄裡了'); break; }
        cheatAddRecipe(id, 1); persist(); refreshCheat(); break;
      }
      case 'cheat-note': cheatCfg().items.push({ type: 'note', title: '', text: '' }); persist(); refreshCheat(true); break;
      case 'cheat-rm': cheatCfg().items.splice(+el.dataset.k, 1); persist(); refreshCheat(); break;
      case 'cheat-mv': {
        const a = cheatCfg().items, k = +el.dataset.k, j = k + +el.dataset.d;
        if (j >= 0 && j < a.length) { [a[k], a[j]] = [a[j], a[k]]; persist(); refreshCheat(); }
        break;
      }
      case 'cheat-print': if (IS_MOBILE) cheatPdf(); else { flush(); window.print(); } break;
      case 'cheat-clear': if (await confirmBox('清空小抄', '確定要清空所有小抄卡片嗎？（食譜不會被刪除）', '清空', true)) { cheatCfg().items = []; persist(); refreshCheat(); } break;
      case 'plan-clear': if (await confirmBox('清空備料單', '確定要清空備料單嗎？（食譜不會被刪除）', '清空', true)) { db.plan = []; persist(); render(); } break;
      // 單價
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
    if (t.lang === 'vi' || t.dataset.ime === 'none') return '';                  // 越南文欄位：不干涉
    if (/^(number|url|password)$/.test(type) || /^(decimal|numeric)$/.test(t.inputMode)) return 'en';
    if (t.id === 'mult' || t.id === 'target' || t.id === 'cloudUrl' || t.dataset.cheatMult != null || t.dataset.plan != null) return 'en';
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
  window.__kitchen = { get db() { return db; }, persist, U, version: APP_VERSION };
  init();
})();
