/* 廚房 SOP 食譜及倍數計算系統 */
(() => {
  'use strict';
  const U = window.KUnits;
  const APP_VERSION = '1.5.0';
  const IS_DESKTOP = /[?&]desktop=1\b/.test(location.search);

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const escML = s => esc(s).replace(/\n/g, '<br>');
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const clone = o => JSON.parse(JSON.stringify(o));
  const normName = s => String(s || '').trim().toLowerCase().replace(/\s+/g, '');
  const viOn = () => !!(window.KVi && window.KVi.on);
  // 使用者內容（食譜名稱、食材、步驟…）：有越南文就排在中文下方
  const bv = (zh, vi) => (viOn() && vi && String(vi).trim() ? `<span class="bi" data-novi>${esc(zh)}<span class="vi" lang="vi">${esc(vi)}</span></span>` : esc(zh));
  const bvML = (zh, vi) => (viOn() && vi && String(vi).trim() ? `<span class="bi" data-novi>${escML(zh)}<span class="vi" lang="vi">${escML(vi)}</span></span>` : escML(zh));
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
    return { version: 1, recipes: [], prices: [], plan: [], settings: { unitMode: 'auto' }, deleted: {}, pricesUpdatedAt: 0, cloud: null, sync: { rev: 0, dirty: false, photos: [] } };
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
  function recipeCost(r, mult, pm) {
    pm = pm || priceMap();
    let total = 0, missing = 0;
    for (const i of r.ingredients) {
      if (!i.name.trim()) continue;
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
        if (e.key === 'Escape') close(null);
        else if (e.key === 'Enter' && e.target.tagName === 'INPUT') { const i = buttons.findIndex(b => /primary|danger/.test(b.cls || '')); if (i >= 0) { e.preventDefault(); pick(i); } }
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
      if (!window.confirm(window.KVi ? window.KVi.both('食譜有尚未儲存的變更，確定要離開嗎？') : '食譜有尚未儲存的變更，確定要離開嗎？')) { history.replaceState(null, '', lastHash); return; }
    }
    if (!isEditHash(location.hash)) draft = null;
    lastHash = location.hash;
    render();
    window.scrollTo(0, 0);
  }

  function render() {
    route = parseRoute();
    const app = $('#app');
    $$('.tabs a').forEach(a => a.classList.toggle('on', a.dataset.tab === ({ r: 'list', edit: 'list', new: 'list' }[route.name] || route.name)));
    switch (route.name) {
      case 'r': app.innerHTML = viewRecipe(route.id); updateRecipeComputed(); break;
      case 'edit': case 'new': app.innerHTML = viewEdit(route.name === 'new' ? null : route.id); break;
      case 'plan': app.innerHTML = viewPlan(); updatePlanTotal(); break;
      case 'cheat': app.innerHTML = viewCheat(); updateCheat(); break;
      case 'prices': app.innerHTML = viewPrices(); break;
      case 'settings': app.innerHTML = viewSettings(); fillSettingsInfo(); setSync(cloudState.s, cloudState.msg); break;
      default: app.innerHTML = viewList(); updateList();
    }
    document.title = (route.name === 'r' && getRecipe(route.id) ? getRecipe(route.id).name + ' - ' : '') + '廚房 SOP 食譜';
  }
  const notFound = () => `<div class="page"><div class="empty"><p>找不到這個食譜，可能已被刪除。</p><a class="btn primary" href="#/">回食譜列表</a></div></div>`;

  // ---------------------------------------------------------------- 食譜列表
  let listFilter = { q: '', cat: '' };
  const catVi = c => { const r = db.recipes.find(x => x.category.trim() === c && x.categoryVi); return r ? r.categoryVi : ''; };
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
        ${cats.map(c => `<button class="chip ${listFilter.cat === c ? 'on' : ''}" data-act="cat" data-v="${esc(c)}">${bv(c, catVi(c))}</button>`).join('')}
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
          ${r.category ? `<div class="cat">${bv(r.category, r.categoryVi)}</div>` : ''}
          <div class="rname">${bv(r.name, r.nameVi)}</div>
          <div class="muted small">${fmt(r.yieldQty)} ${esc(r.yieldUnit)} · ${r.ingredients.length} 食材 · ${r.steps.length} 步驟${mins ? ` · 約 ${fmt(mins)} 分` : ''}</div>
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
          ${r.category ? `<div class="cat">${bv(r.category, r.categoryVi)}</div>` : ''}
          <h1>${bv(r.name, r.nameVi)}</h1>
          <div class="muted">基準份量 ${fmt(r.yieldQty)} ${esc(r.yieldUnit)} · ${r.ingredients.length} 項食材 · ${r.steps.length} 個步驟${mins ? ` · 計時合計約 ${fmt(mins)} 分鐘` : ''}</div>
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
              <div class="step-text">${bvML(s.text, s.textVi)}</div>
              <div class="step-meta">${s.key ? '<span class="badge red">重點</span>' : ''}
              ${s.minutes ? `<button class="btn sm timer-btn" data-act="timer" data-s="${esc(s.id)}">⏱ 計時 ${fmtDur(s.minutes * 60)}</button>` : ''}</div>
            </div></li>`).join('')}</ol>` : '<p class="muted">尚未建立步驟。</p>'}
      </section>
      ${r.notes.trim() ? `<section class="card"><h2>備註</h2><p>${bvML(r.notes, r.notesVi)}</p></section>` : ''}
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
      if (i.group.trim() !== (lastGroup || '') && (i.group.trim() || lastGroup)) {
        html += `<tr class="grp"><td colspan="6">${i.group.trim() ? bv(i.group.trim(), i.groupVi) : '其他'}</td></tr>`;
      }
      lastGroup = i.group.trim();
      const q = i.qty == null ? null : i.qty * mult;
      const d = U.display(q, i.unit, mode);
      const c = costOf(pm, i.name, q, i.unit);
      const on = st.checked.has(i.id);
      html += `<tr class="${on ? 'done' : ''}">
        <td class="ck"><input type="checkbox" data-act="check" data-i="${esc(i.id)}" ${on ? 'checked' : ''} aria-label="已備好"></td>
        <td class="nm">${bv(i.name, i.nameVi)}${i.note ? `<div class="note">${bv(i.note, i.noteVi)}</div>` : ''}</td>
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
  function beep() {
    if (!audioCtx) return;
    const t0 = audioCtx.currentTime;
    for (let k = 0; k < 3; k++) {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = 'square'; o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, t0 + k * 0.25);
      g.gain.exponentialRampToValueAtTime(0.25, t0 + k * 0.25 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + k * 0.25 + 0.18);
      o.connect(g).connect(audioCtx.destination);
      o.start(t0 + k * 0.25); o.stop(t0 + k * 0.25 + 0.2);
    }
  }
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
    if (ringing.length && !ringH) { beep(); ringH = setInterval(beep, 1800); }
    if (!ringing.length && ringH) { clearInterval(ringH); ringH = null; }
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
    const r = draft.r, V = viOn();
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
        <div class="ed-list">${r.ingredients.map((i, k) => `<div class="ed-row ing">
          <input class="g" data-bind="ingredients.${k}.group" value="${esc(i.group)}" placeholder="分組" list="dl-grp">
          <input class="n" data-bind="ingredients.${k}.name" value="${esc(i.name)}" placeholder="食材名稱" list="dl-names">
          <input class="q" data-bind="ingredients.${k}.qty" value="${esc(i.qty)}" placeholder="數量" inputmode="decimal">
          <input class="u" data-bind="ingredients.${k}.unit" value="${esc(i.unit)}" placeholder="單位" list="dl-units">
          <input class="nt" data-bind="ingredients.${k}.note" value="${esc(i.note)}" placeholder="備註（切丁、適量…）">
          ${btns('ingredients', k, r.ingredients.length)}
          ${V ? `<div class="vi-row">${viIn(`ingredients.${k}.groupVi`, i.groupVi, '分組（越南文）').replace('class="vi-in"', 'class="vi-in g"')}${viIn(`ingredients.${k}.nameVi`, i.nameVi, '食材名稱（越南文）').replace('class="vi-in"', 'class="vi-in n"')}${viIn(`ingredients.${k}.noteVi`, i.noteVi, '備註（越南文）').replace('class="vi-in"', 'class="vi-in nt"')}</div>` : ''}</div>`).join('')}</div>
        <button class="btn" data-act="add" data-list="ingredients">＋ 新增食材</button>
        <p class="hint">數量可填 1.5、1/2、1 1/2；留空代表「適量」，不參與倍數計算。分組可區分「醃料」「醬汁」等。</p>
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
        <p class="hint">越南文欄位留空會在儲存時自動翻譯（需連線 Google 雲端），也可以自己修改。</p>` : ''}
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
          <a class="pname" href="#/r/${encodeURIComponent(r.id)}">${bv(r.name, r.nameVi)}</a>
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
        if (!k) continue;
        let e = map.get(k);
        if (!e) map.set(k, (e = { name: i.name.trim(), vi: '', parts: [], from: new Set(), loose: false }));
        if (!e.vi && i.nameVi) e.vi = i.nameVi;
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
      return `<tr><td class="ck"><input type="checkbox" aria-label="已備好" data-act="plan-check"></td><td class="nm">${bv(e.name, e.vi)}<div class="note">${esc([...e.from].join('、'))}</div></td>
        <td class="amt">${amts.join('<br>')}</td><td class="cost">${e.parts.length ? (miss ? (cost ? money(cost) + ' <span class="warn">*</span>' : '<span class="muted">無單價</span>') : money(cost)) : ''}</td></tr>`;
    });
    el.innerHTML = `<table class="ing-table plan-table"><tbody>${rows.join('')}</tbody></table>
      <div class="cost-box"><div><span class="muted">食材總成本</span><b>${money(total)}</b></div>
      ${missing ? `<div class="warn small">* 有 ${missing} 項食材缺少單價或單位不符，未完整計入。</div>` : ''}</div>`;
  }

  // ---------------------------------------------------------------- 小抄
  // 存在 settings.cheat，跟著設定一起同步到雲端
  const CHEAT_DEF = { items: [], ing: true, steps: 'key', notes: true, cost: false, layout: 'two', size: 'm' };
  function cheatCfg() {
    const c = Object.assign({}, CHEAT_DEF, db.settings.cheat || {});
    c.items = (Array.isArray(c.items) ? c.items : []).filter(x => x && (x.type === 'note' || getRecipe(x.recipeId)));
    return (db.settings.cheat = c);
  }
  function cheatAddRecipe(id, mult) {
    const c = cheatCfg(), it = c.items.find(x => x.type !== 'note' && x.recipeId === id);
    if (it) it.mult = mult; else c.items.push({ type: 'recipe', recipeId: id, mult });
  }

  function viewCheat() {
    const c = cheatCfg();
    const avail = [...db.recipes].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
    const opt = (k, v, t) => `<option value="${v}" ${c[k] === v ? 'selected' : ''}>${t}</option>`;
    const box = (k, t) => `<label class="ck-lbl"><input type="checkbox" data-cheat-opt="${k}" ${c[k] ? 'checked' : ''}> ${t}</label>`;
    const items = c.items.map((it, k) => {
      const tools = `<button class="icon" data-act="cheat-mv" data-k="${k}" data-d="-1" title="上移">↑</button><button class="icon" data-act="cheat-mv" data-k="${k}" data-d="1" title="下移">↓</button>
        <button class="icon danger" data-act="cheat-rm" data-k="${k}" title="移除">✕</button>`;
      if (it.type === 'note') return `<div class="cheat-item note">
        <div class="ci-row"><input type="text" placeholder="卡片標題（例如：出餐順序、注意事項）" data-cheat-note="${k}" data-f="title" value="${esc(it.title || '')}">${tools}</div>
        <textarea rows="3" placeholder="內容，一行一點" data-cheat-note="${k}" data-f="text">${esc(it.text || '')}</textarea></div>`;
      const r = getRecipe(it.recipeId);
      return `<div class="cheat-item"><div class="ci-row"><span class="pname">${bv(r.name, r.nameVi)}</span>
        <label class="inline">×<input type="text" autocomplete="off" placeholder="2 或 /3" data-cheat-mult="${k}" value="${multText(it.mult)}"></label>
        <span class="muted small" id="cy${k}">${fmt(r.yieldQty * it.mult)} ${esc(r.yieldUnit)}</span>${tools}</div></div>`;
    }).join('');
    return `<div class="page cheat-page">
      <div class="page-head no-print"><h1 class="head-title">小抄</h1><div class="spacer"></div>
        ${c.items.length ? '<button class="btn primary" data-act="print">🖨 列印小抄</button><button class="btn ghost" data-act="cheat-clear">清空</button>' : ''}</div>
      <p class="muted no-print">把食譜依倍數濃縮成精簡卡片（份量、食材用量、重點步驟），列印後可剪下貼在工作台；也能加自訂文字卡。</p>
      <section class="card no-print">
        <h2>卡片</h2>
        <div class="cheat-items">${items || '<p class="muted">尚未加入卡片。</p>'}</div>
        <div class="plan-add">
          ${avail.length ? `<select id="cheatAdd">${avail.map(r => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('')}</select>
          <button class="btn primary" data-act="cheat-add">＋ 食譜</button>` : ''}
          <button class="btn" data-act="cheat-note">＋ 文字卡</button>
          ${db.plan.length ? '<button class="btn" data-act="cheat-from-plan">從備料單匯入</button>' : ''}
        </div>
      </section>
      <section class="card no-print">
        <h2>內容與版面</h2>
        <div class="cheat-opts">
          ${box('ing', '食材用量')}${box('notes', '食譜備註')}${box('cost', '成本')}
          <label class="fld inline-fld">步驟<select data-cheat-opt="steps">${opt('steps', 'key', '只列重點步驟')}${opt('steps', 'all', '全部步驟')}${opt('steps', 'none', '不列步驟')}</select></label>
          <label class="fld inline-fld">版面<select data-cheat-opt="layout">${opt('layout', 'two', '兩欄小卡')}${opt('layout', 'one', '單欄')}${opt('layout', 'page', '一頁一張')}</select></label>
          <label class="fld inline-fld">字級<select data-cheat-opt="size">${opt('size', 's', '小')}${opt('size', 'm', '中')}${opt('size', 'l', '大')}</select></label>
          <label class="fld inline-fld">單位${unitModeSelect('unitMode4')}</label>
        </div>
      </section>
      <div id="cheatCards"></div>
    </div>`;
  }

  function cheatCard(it, c) {
    if (it.type === 'note') {
      const split = t => String(t || '').split('\n').map(x => x.trim()).filter(Boolean);
      const lines = split(it.text), vis = split(it.textVi);
      const paired = vis.length === lines.length;
      return `<article class="cheat-card"><header><h3>${it.title ? bv(it.title, it.titleVi) : '小抄'}</h3></header>
        ${lines.length ? `<ul class="cc-list">${lines.map((l, k) => `<li>${bv(l, paired ? vis[k] : '')}</li>`).join('')}</ul>
        ${!paired && viOn() && vis.length ? `<ul class="cc-list vi" lang="vi">${vis.map(l => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}` : '<p class="muted">（尚未填寫內容）</p>'}</article>`;
    }
    const r = getRecipe(it.recipeId), mult = it.mult, mode = db.settings.unitMode;
    let body = '';
    if (c.ing && r.ingredients.length) {
      let last = null, rows = '';
      for (const i of r.ingredients) {
        const g = i.group.trim();
        if (g !== (last || '') && (g || last)) rows += `<div class="cc-grp">${g ? bv(g, i.groupVi) : '其他'}</div>`;
        last = g;
        const d = U.display(i.qty == null ? null : i.qty * mult, i.unit, mode);
        rows += `<div class="cc-ing"><span>${bv(i.name, i.nameVi)}</span><b>${esc(d.text)}</b></div>`;
      }
      body += `<div class="cc-ings">${rows}</div>`;
    }
    const steps = c.steps === 'none' ? [] : r.steps.map((s, k) => ({ ...s, n: k + 1 })).filter(s => c.steps === 'all' || s.key);
    if (steps.length) body += `<ol class="cc-steps">${steps.map(s => `<li value="${s.n}" class="${s.key ? 'key' : ''}">${s.key && c.steps === 'all' ? '★ ' : ''}${bvML(s.text, s.textVi)}${s.minutes ? ` <span class="cc-min">⏱${fmt(s.minutes)}分</span>` : ''}</li>`).join('')}</ol>`;
    if (c.notes && r.notes.trim()) body += `<div class="cc-notes">${bvML(r.notes.trim(), r.notesVi)}</div>`;
    if (c.cost) { const k = recipeCost(r, mult, priceMap()); body += `<div class="cc-cost">成本 ${money(k.total)}　每${esc(r.yieldUnit)} ${money(k.perUnit)}${k.missing ? '（部分未計）' : ''}</div>`; }
    return `<article class="cheat-card"><header><h3>${bv(r.name, r.nameVi)}</h3>
      <span class="cc-scale">${mult === 1 ? '' : `× ${multText(mult)}　`}${fmt(r.yieldQty * mult)} ${esc(r.yieldUnit)}</span></header>${body || '<p class="muted">（沒有勾選要顯示的內容）</p>'}</article>`;
  }

  function updateCheat() {
    const el = $('#cheatCards');
    if (!el) return;
    const c = cheatCfg();
    el.className = `cheat-grid lay-${c.layout} fs-${c.size}`;
    el.innerHTML = c.items.map(it => cheatCard(it, c)).join('');
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
    for (const r of db.recipes) for (const i of r.ingredients) { const k = normName(i.name); if (k) used.set(k, (used.get(k) || 0) + 1); }
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
      <h1 class="head-title">設定與資料</h1>
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
        <h2>介面與食譜越南文</h2>
        <p class="muted">在每段中文下方顯示越南文（只影響這台裝置）。食譜內容會用 Google 翻譯自動產生越南文，可在編輯食譜時修改。</p>
        <div class="btn-row">
          <label class="ck-lbl"><input type="checkbox" data-act="vi-toggle" ${viOn() ? 'checked' : ''}> 顯示越南文</label>
          ${viOn() ? '<button class="btn" data-act="tr-all">🌐 翻譯全部食譜</button>' : ''}
        </div>
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
    return { db: { ...shareable(db), recipes }, photos };
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
    const localPrices = local.pricesUpdatedAt >= remote.pricesUpdatedAt;
    return {
      ...local, recipes, deleted,
      prices: localPrices ? local.prices : remote.prices,
      pricesUpdatedAt: Math.max(local.pricesUpdatedAt, remote.pricesUpdatedAt),
    };
  }

  function applyRemote(L, merge) {
    const remote = normalizeDb(L.db);
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
      case 'tr-all': autoTranslate(true); break;
      case 'vi-toggle': window.KVi.setOn(!viOn()); break;
      // 小抄
      case 'cheat-from-recipe': cheatAddRecipe(el.dataset.id, vs(el.dataset.id).mult); persist(); location.hash = '#/cheat'; break;
      case 'cheat-from-plan': db.plan.forEach(p => cheatAddRecipe(p.recipeId, p.mult)); persist(); if (route.name === 'cheat') render(); else location.hash = '#/cheat'; break;
      case 'cheat-add': {
        const id = $('#cheatAdd').value;
        if (cheatCfg().items.some(x => x.recipeId === id)) { toast('這道菜已經在小抄裡了'); break; }
        cheatAddRecipe(id, 1); persist(); render(); break;
      }
      case 'cheat-note': cheatCfg().items.push({ type: 'note', title: '', text: '' }); persist(); render(); { const t = $$('[data-cheat-note][data-f="title"]').pop(); if (t) t.focus(); } break;
      case 'cheat-rm': cheatCfg().items.splice(+el.dataset.k, 1); persist(); render(); break;
      case 'cheat-mv': {
        const a = cheatCfg().items, k = +el.dataset.k, j = k + +el.dataset.d;
        if (j >= 0 && j < a.length) { [a[k], a[j]] = [a[j], a[k]]; persist(); render(); }
        break;
      }
      case 'cheat-clear': if (await confirmBox('清空小抄', '確定要清空所有小抄卡片嗎？（食譜不會被刪除）', '清空', true)) { cheatCfg().items = []; persist(); render(); } break;
      case 'plan-clear': if (await confirmBox('清空備料單', '確定要清空備料單嗎？（食譜不會被刪除）', '清空', true)) { db.plan = []; persist(); render(); } break;
      // 單價
      case 'price-add': priceFilter = ''; db.prices.push(normPrice({})); db.pricesUpdatedAt = Date.now(); persist(); render(); { const ins = $$('[data-price$=".name"]'); ins.length && ins[ins.length - 1].focus(); } break;
      case 'price-rm': db.prices.splice(+el.dataset.k, 1); db.pricesUpdatedAt = Date.now(); persist(); render(); break;
      case 'price-import': {
        const have = new Set(db.prices.map(p => normName(p.name)));
        let n = 0;
        for (const r of db.recipes) for (const i of r.ingredients) {
          const k = normName(i.name);
          if (k && !have.has(k)) { have.add(k); db.prices.push(normPrice({ name: i.name.trim(), perQty: 1, perUnit: U.lookup(i.unit) ? (U.lookup(i.unit).dim === 'mass' ? 'kg' : 'L') : i.unit })); n++; }
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

  document.addEventListener('input', e => {
    const t = e.target;
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
  });

  document.addEventListener('change', async e => {
    const t = e.target, act = t.dataset.actChange;
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
    } else if (act === 'import' && t.files[0]) {
      await importData(t.files[0]); t.value = '';
    }
  });

  window.addEventListener('beforeunload', e => { flush(); if (draft && draft.dirty) { e.preventDefault(); e.returnValue = ''; } });
  document.addEventListener('visibilitychange', async () => {
    if (!document.hidden && wakeLock === null && $('[data-act="wake"].on')) { try { wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { /* ignore */ } }
    if (!document.hidden) { tick(); if (db && db.cloud) cloudSync(); }
    else flush();
  });

  // ---------------------------------------------------------------- 啟動
  async function init() {
    if (window.KVi) { window.KVi.start(); const b = $('#viBtn'); if (b) b.classList.toggle('on', viOn()); }
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
    if (!IS_DESKTOP && navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  }

  // 供桌面版自我測試使用
  window.__kitchen = { get db() { return db; }, persist, U, version: APP_VERSION };
  init();
})();
