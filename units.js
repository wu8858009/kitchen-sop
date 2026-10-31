/* 單位換算與數量格式化（瀏覽器 window.KUnits / Node module.exports） */
(function (root) {
  'use strict';

  // [別名..., 維度, 換算成基準單位(g / ml)的倍數, 顯示名稱]
  const DEFS = [
    [['g', '公克', '克', 'gram', 'grams'], 'mass', 1, 'g'],
    [['kg', '公斤', '千克', 'kgs'], 'mass', 1000, 'kg'],
    [['mg', '毫克'], 'mass', 0.001, 'mg'],
    [['台斤', '斤'], 'mass', 600, '台斤'],
    [['兩', '台兩'], 'mass', 37.5, '兩'],
    [['錢'], 'mass', 3.75, '錢'],
    [['lb', 'lbs', '磅'], 'mass', 453.59237, 'lb'],
    [['oz', '盎司'], 'mass', 28.349523125, 'oz'],
    [['ml', '毫升', 'cc', 'c.c.'], 'vol', 1, 'ml'],
    [['l', '公升', '升', 'liter', 'litre'], 'vol', 1000, 'L'],
    [['大匙', '湯匙', 'tbsp'], 'vol', 15, '大匙'],
    [['小匙', '茶匙', 'tsp'], 'vol', 5, '小匙'],
    [['杯', '量杯', 'cup', 'cups'], 'vol', 240, '杯'],
    [['米杯'], 'vol', 180, '米杯'],
  ];
  const TABLE = new Map();
  for (const [names, dim, f, canon] of DEFS) for (const n of names) TABLE.set(n.toLowerCase(), { canon, dim, f });

  function toHalfWidth(s) {
    return String(s).replace(/[！-～]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/　/g, ' ');
  }

  function lookup(unit) {
    if (unit == null) return null;
    const k = toHalfWidth(unit).trim().toLowerCase();
    return k ? TABLE.get(k) || null : null;
  }

  const VULGAR = { '½': 0.5, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 0.25, '¾': 0.75, '⅛': 0.125 };

  /** "1.5"、"1/2"、"1 1/2"、"½"、"1½" → 數字；無法辨識回傳 null */
  function parseQty(str) {
    if (str == null) return null;
    if (typeof str === 'number') return isFinite(str) ? str : null;
    let s = toHalfWidth(str).trim().replace(/,/g, '');
    if (!s) return null;
    let extra = 0;
    const v = s.slice(-1);
    if (VULGAR[v] !== undefined) { extra = VULGAR[v]; s = s.slice(0, -1).trim(); if (!s) return extra; }
    let m;
    if ((m = s.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/))) return +m[3] ? +m[1] + m[2] / m[3] + extra : null;
    if ((m = s.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/))) return +m[2] ? m[1] / m[2] + extra : null;
    if (/^\d*\.?\d+$/.test(s) || /^\d+\.$/.test(s)) return parseFloat(s) + extra;
    return null;
  }

  /** "3 kg"、"600g"、"1/2 台斤" → {qty, unit}；只有數字時 unit 為 '' */
  function parseAmount(str) {
    const s = toHalfWidth(str || '').trim();
    const m = s.match(/^(\d+\s+\d+\s*\/\s*\d+|\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?|\d*\.?\d+[½⅓⅔¼¾⅛]?|[½⅓⅔¼¾⅛])\s*(.*)$/);
    if (!m) return null;
    const qty = parseQty(m[1]);
    return qty == null ? null : { qty, unit: m[2].trim() };
  }

  /** 換算數量；維度不同或無法換算時回傳 null。完全相同的非標準單位（顆、包…）可直接換算 */
  function convert(qty, from, to) {
    if (qty == null) return null;
    const a = lookup(from), b = lookup(to);
    if (a && b) return a.dim === b.dim ? qty * a.f / b.f : null;
    if (!a && !b && String(from || '').trim() === String(to || '').trim()) return qty;
    return null;
  }

  function fmtNum(n) {
    if (n == null || !isFinite(n)) return '';
    const a = Math.abs(n);
    const d = a >= 100 ? 0 : a >= 10 ? 1 : a >= 1 ? 2 : a >= 0.1 ? 2 : 3;
    let s = n.toFixed(d);
    if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
    return s === '-0' ? '0' : s;
  }

  function metric(base, dim) {
    if (dim === 'mass') return base >= 1000 ? [base / 1000, 'kg'] : base < 1 && base > 0 ? [base * 1000, 'mg'] : [base, 'g'];
    return base >= 1000 ? [base / 1000, 'L'] : [base, 'ml'];
  }

  const join = (q, u) => (u ? fmtNum(q) + ' ' + u : fmtNum(q));

  /**
   * 依顯示模式格式化數量。
   * mode: 'auto'（g↔kg、ml↔L、大量的匙改 ml）| 'original' | 'metric' | 'tw'
   * 回傳 {text, alt}；alt 為括號內的輔助換算（可能為 ''）。
   */
  function display(qty, unit, mode) {
    unit = String(unit || '').trim();
    if (qty == null) return { text: unit || '適量', alt: '' };
    const u = lookup(unit);
    if (!u || mode === 'original') return { text: join(qty, unit), alt: '' };
    const base = qty * u.f;
    if (mode === 'tw') {
      if (u.dim === 'mass') {
        const m = metric(base, 'mass');
        if (base >= 600) return { text: join(base / 600, '台斤'), alt: join(m[0], m[1]) };
        if (base >= 37.5) return { text: join(base / 37.5, '兩'), alt: join(m[0], m[1]) };
        return { text: join(m[0], m[1]), alt: '' };
      }
      const m = metric(base, 'vol');
      return { text: join(m[0], m[1]), alt: u.canon === 'ml' || u.canon === 'L' ? '' : join(qty, u.canon) };
    }
    if (mode === 'metric') {
      const m = metric(base, u.dim);
      const same = m[1] === u.canon || (['g', 'kg', 'mg', 'ml', 'L'].indexOf(u.canon) >= 0);
      return { text: join(m[0], m[1]), alt: same ? '' : join(qty, u.canon) };
    }
    // auto
    if (['g', 'kg', 'mg', 'ml', 'L'].indexOf(u.canon) >= 0) {
      const m = metric(base, u.dim);
      return { text: join(m[0], m[1]), alt: '' };
    }
    if ((u.canon === '大匙' || u.canon === '小匙') && base >= 60) {
      const m = metric(base, 'vol');
      return { text: join(m[0], m[1]), alt: join(qty, u.canon) };
    }
    return { text: join(qty, u.canon), alt: '' };
  }

  /** 加總同一食材的多筆數量 → [{qty, unit}]（同單位保留該單位，不同單位換成 g / ml） */
  function sum(parts) {
    const dims = {}, other = {};
    for (const p of parts) {
      if (p.qty == null) continue;
      const u = lookup(p.unit);
      if (u) {
        const d = dims[u.dim] || (dims[u.dim] = { base: 0, units: new Set() });
        d.base += p.qty * u.f;
        d.units.add(u.canon);
      } else {
        const k = String(p.unit || '').trim();
        other[k] = (other[k] || 0) + p.qty;
      }
    }
    const out = [];
    for (const dim of ['mass', 'vol']) {
      const d = dims[dim];
      if (!d) continue;
      if (d.units.size === 1) {
        const canon = [...d.units][0];
        out.push({ qty: d.base / lookup(canon).f, unit: canon });
      } else out.push({ qty: d.base, unit: dim === 'mass' ? 'g' : 'ml' });
    }
    for (const k of Object.keys(other)) out.push({ qty: other[k], unit: k });
    return out;
  }

  const api = { lookup, parseQty, parseAmount, convert, fmtNum, display, sum, DEFS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KUnits = api;
})(typeof window !== 'undefined' ? window : this);
