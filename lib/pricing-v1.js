/*!
 * UD-Cost Hub — pricing-v1.js
 * โค้ดคิดราคากลางที่ใช้ร่วมกันระหว่าง UD-Cost Hub และ UD-Total-Station
 *
 * มีแต่การคำนวณ ไม่แตะหน้าจอ ใช้ได้ทั้งในเบราว์เซอร์ (window.UDPrice) และ Node (module.exports)
 *
 * ข้อมูลที่ใช้:
 *   ชีต A (SHEET_ID)      totaldata = ราคาวัสดุพาณิชย์ 7 จังหวัด + "ราคาที่ใช้"
 *                         work_STR/ARC/SN/EE/AC = ค่าแรง ว480 (คอลัมน์ G = รหัสแถว)
 *   ชีต B (COMP_SHEET_ID) mat_ref, comp_list, comp_items = วัสดุมวลรวมตามเล่มหลักเกณฑ์ 2569
 *
 * กฎสำคัญ:
 *   - ราคาวัสดุใช้คอลัมน์ "ราคาที่ใช้" ของชีต (จังหวัดที่ตั้งโครงการก่อน ไม่มีจึงใช้จังหวัดข้างเคียง ตามประกาศข้อ 9.3)
 *   - รหัสพาณิชย์หลายรหัส (คั่น , ) ใช้รหัสแรกที่มีราคา
 *   - แปลงหน่วยไม่ได้ = ไม่ใส่ราคา (ไม่เดา)
 *   - ราคาต่อหน่วยวัสดุมวลรวม ปัดทศนิยม 2 ตำแหน่งแบบปัดปกติ (round half up)
 *
 * การเปลี่ยนที่ทำให้ผลเดิมเปลี่ยน ให้ออกเป็นไฟล์เวอร์ชันใหม่ (pricing-v2.js) ห้ามแก้ไฟล์นี้ทับ
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.UDPrice = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VERSION = '1.0.0';

  // ============================================================
  // CONFIG
  // ============================================================
  const CONFIG = {
    SHEET_ID: '1eU_2iNI4_Y6Hnuj5_-9BgjBQ9Ga7QAkRJ-CQk1Dve78',
    COMP_SHEET_ID: '1Kw4rcFvpscpIrdnIUUxWW8ZhQvT17uky0sdAqyfYWZg',
    SH_DATA: 'totaldata',
    SH_CAT: 'หมวด',
    PROVS: [
      { name: 'อุดรธานี', c: 5 }, { name: 'หนองคาย', c: 6 }, { name: 'เลย', c: 7 },
      { name: 'สกลนคร', c: 8 }, { name: 'หนองบัวลำภู', c: 9 }, { name: 'กาฬสินธุ์', c: 10 }, { name: 'ขอนแก่น', c: 11 }
    ],
    WAGE_SHEETS: [
      { sheet: 'work_STR', label: 'งานโครงสร้างวิศวกรรม' },
      { sheet: 'work_ARC', label: 'งานสถาปัตยกรรม' },
      { sheet: 'work_SN', label: 'งานระบบสุขาภิบาลและดับเพลิง' },
      { sheet: 'work_EE', label: 'งานระบบไฟฟ้าและสื่อสาร' },
      { sheet: 'work_AC', label: 'งานระบบปรับอากาศและระบายอากาศ' },
    ],
    // ราคาตายตัว: item_code → ราคา (บาท/หน่วย)
    FIXED_PRICES: {
      '8': 0.0164, // น้ำ บาท/ลิตร
      '58': 300,   // ค่ายก บาท/เที่ยว
      '59': 1,     // ค่าวาง หน่วย/เมตร
    },
    COMP_GROUPS: {
      '1': '1. งานคอนกรีตส่วนผสมต่างๆ (ผสมเอง)', '2': '2. งานคอนกรีตตามมาตรฐานกรมโยธาฯ (ผสมเอง)',
      '3': '3. งานคอนกรีตเททับหน้าพื้นสำเร็จรูป', '4': '4. งานคอนกรีตเสาเอ็น คานทับหลัง และเคาน์เตอร์ คสล.',
      '5': '5. งานทำฝ้าเพดาน', '6': '6. งานก่อผนัง',
      '7': '7. งานฉาบปูน, งานทำผิวผนัง และงานบุผนัง', '8': '8. งานทำผนังเบา',
      '9': '9. งานปูพื้น', '10': '10. งานทาสี',
      '11': '11. งานท่อระบายน้ำ', '12': '12. งานอื่นๆ',
    },
    MAX_SUB_DEPTH: 4,
  };

  // ============================================================
  // UTILITY
  // ============================================================
  function cv(c) { return (!c || c.v === null || c.v === undefined) ? '' : String(c.v).trim(); }
  function nv(c) {
    if (!c || c.v === null || c.v === undefined) return null;
    const n = parseFloat(String(c.v).replace(/,/g, ''));
    return isNaN(n) || n <= 0 ? null : n;
  }
  // ปัดทศนิยม 2 ตำแหน่งแบบปัดปกติ (0.005 ขึ้น) กันเศษทศนิยมของเลขฐานสอง เช่น 1.005
  function round2(x) {
    if (x === null || x === undefined || !isFinite(x)) return x;
    const s = x < 0 ? -1 : 1;
    return s * Math.round(+(Math.abs(x) * 100).toFixed(6)) / 100;
  }
  function gvizURL(sheetId, sh) {
    return `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?sheet=${encodeURIComponent(sh)}&tqx=out:json`;
  }
  function parseGviz(text) {
    return JSON.parse(text.replace(/^[^{]+/, '').replace(/[^}]+$/, '')).table;
  }
  async function fetchSheet(sheetId, sh, fetchFn) {
    const f = fetchFn || (typeof fetch !== 'undefined' ? fetch : null);
    if (!f) throw new Error('ไม่มี fetch');
    const r = await f(gvizURL(sheetId, sh));
    return parseGviz(await r.text());
  }

  // ============================================================
  // PARSE — แปลงตาราง gviz เป็นข้อมูล (โครงสร้างเดียวกับที่ UD-Cost Hub ใช้)
  // ============================================================
  const parse = {
    cats(table) {
      const out = [];
      if (table && table.rows) table.rows.forEach(row => {
        const id = cv(row.c[0]), nm = cv(row.c[1]);
        if (id) out.push({ id, name: nm });
      });
      return out;
    },
    materials(table) {
      const out = [];
      if (table && table.rows) table.rows.forEach(row => {
        const catId = cv(row.c[0]);
        if (!catId) return;
        out.push({
          catId, catName: cv(row.c[1]),
          code: cv(row.c[2]), name: cv(row.c[3]), unit: cv(row.c[4]),
          provinces: CONFIG.PROVS.map(p => ({ name: p.name, val: nv(row.c[p.c]) })),
          price: nv(row.c[12]), province: cv(row.c[13]),
          period: cv(row.c[14]), dlDate: cv(row.c[15]),
        });
      });
      return out;
    },
    // ws = {sheet, label}
    wages(table, ws) {
      const out = [];
      if (table && table.rows) table.rows.forEach(row => {
        const h1 = cv(row.c[0]);
        if (!h1) return;
        out.push({
          code: cv(row.c[6]),
          sheet: ws.sheet,
          sheetLabel: ws.label,
          h1, h2: cv(row.c[1]), h3: cv(row.c[2]), h4: cv(row.c[3]),
          unit: cv(row.c[4]),
          rawPrice: cv(row.c[5]),
          price: nv(row.c[5]),
        });
      });
      return out;
    },
    matRef(table) {
      const map = {};
      if (table && table.rows) table.rows.forEach(row => {
        const code = cv(row.c[0]);
        if (!code || code === 'รหัส' || !cv(row.c[1])) return;
        map[String(code).trim()] = {
          name: cv(row.c[1]), unit: cv(row.c[2]), commodityCode: cv(row.c[3]),
          compRef: cv(row.c[4]), // คอลัมน์ E: ดึงราคาจากส่วนผสม เช่น 123 หรือ 12.3
        };
      });
      return map;
    },
    compList(table) {
      const out = [];
      if (table && table.rows) table.rows.forEach(row => {
        const id = cv(row.c[0]);
        if (!id || id === 'comp_id') return;
        out.push({ id: String(id).trim(), group: cv(row.c[1]), sub: cv(row.c[2]), name: cv(row.c[3]), unit: cv(row.c[4]) });
      });
      return out;
    },
    compItems(table) {
      const out = [];
      if (table && table.rows) table.rows.forEach(row => {
        const cid = cv(row.c[0]);
        if (!cid || cid === 'comp_id') return;
        const itemCode = String(cv(row.c[2])).trim();
        const fixedPrice = itemCode && CONFIG.FIXED_PRICES[itemCode] ? CONFIG.FIXED_PRICES[itemCode] : null;
        const commodityCode = cv(row.c[6]).replace(/^="?|"?$/g, '').trim(); // ตัด ="..." ที่ติดมาจาก CSV
        out.push({
          compId: String(cid).trim(),
          seq: cv(row.c[1]),
          itemCode,
          itemName: cv(row.c[3]),
          qty: (() => { const v = cv(row.c[4]).trim(); return v === '' || v === null ? null : parseFloat(v) || 0; })(),
          unit: cv(row.c[5]),
          commodityCode,
          userInput: cv(row.c[7]),
          fixedPrice,
        });
      });
      return out;
    },
  };

  // ============================================================
  // UNIT CONVERSION — แปลงราคาจากหน่วยพาณิชย์ → หน่วยของวัสดุมวลรวม
  // ใช้ทั้งหน่วยและขนาดบรรจุในชื่อสินค้า เช่น "ขนาด 2.1 ลิตร", "บรรจุ 50 กก./ถุง", "ยาว 10 เมตร"
  // ถ้าแปลงไม่ได้จะคืน ok:false ไม่เดาราคา
  // ============================================================
  const UNIT_TABLE = {
    // มวล (ฐาน กก.)
    'กก.': ['mass', 1], 'กก': ['mass', 1], 'กิโลกรัม': ['mass', 1], 'kg': ['mass', 1], 'ตัน': ['mass', 1000], 'กรัม': ['mass', 0.001],
    // ปริมาตร (ฐาน ลิตร)
    'ลิตร': ['vol', 1], 'l': ['vol', 1], 'มล.': ['vol', 0.001], 'ซีซี': ['vol', 0.001],
    'gl.': ['vol', 3.785], 'gl': ['vol', 3.785], 'แกลลอน': ['vol', 3.785], 'แกลอน': ['vol', 3.785],
    'ลบ.ม.': ['vol', 1000], 'ลบ.ซม.': ['vol', 0.001], 'cc': ['vol', 0.001], 'ลบ.ฟ.': ['vol', 28.3168], 'ลบ.ฟุต': ['vol', 28.3168],
    // ความยาว (ฐาน ม.)
    'ม.': ['len', 1], 'ม': ['len', 1], 'เมตร': ['len', 1], 'ซม.': ['len', 0.01], 'มม.': ['len', 0.001], 'ฟุต': ['len', 0.3048],
    // พื้นที่ (ฐาน ตร.ม.)
    'ตร.ม.': ['area', 1], 'ตร.ซม.': ['area', 0.0001], 'ตร.ฟุต': ['area', 0.092903], 'ตร.ฟ.': ['area', 0.092903],
    // นับจำนวน
    'โหล': ['count', 12],
  };
  const COUNT_UNITS = ['แผ่น', 'ก้อน', 'อัน', 'ตัว', 'ชิ้น', 'ท่อน', 'บาน', 'ชุด', 'ใบ', 'ดวง', 'หลอด', 'เส้น', 'ลูก', 'ดอก', 'หัว', 'ต้น'];
  const UNIT_ALIAS = { 'ม.': 'เมตร', 'ม': 'เมตร', 'เมตร': 'เมตร', 'กก': 'กก.', 'ตรม.': 'ตร.ม.', 'ลบม.': 'ลบ.ม.' };

  function _num(x) { return parseFloat(String(x).replace(/,/g, '')); }
  function normUnit(u) { u = String(u || '').trim(); return UNIT_ALIAS[u] || u; }
  // อ่านขนาดบรรจุจากชื่อสินค้า
  function pkgContents(name) {
    const n = String(name || '').replace(/\s+/g, ' ');
    const out = {};
    let m;
    if ((m = n.match(/([\d.,]+)\s*(?:ลิตร|ลิตร\.)/))) out.vol = _num(m[1]);
    else if ((m = n.match(/([\d.,]+)\s*(?:มล\.|ml|ซีซี)/i))) out.vol = _num(m[1]) * 0.001;
    else if ((m = n.match(/([\d.,]+)\s*แกลลอน/))) out.vol = _num(m[1]) * 3.785;
    if ((m = n.match(/([\d.,]+)\s*(?:กก\.?|กิโลกรัม)\s*(?:\/|ต่อ)?\s*(?:ถุง|กระป๋อง|ถัง|กล่อง|ลัง|ม้วน|ท่อน|แผ่น)?/))) out.mass = _num(m[1]);
    else if ((m = n.match(/([\d.,]+)\s*กรัม/))) out.mass = _num(m[1]) * 0.001;
    if ((m = n.match(/ยาว\s*([\d.,]+)\s*(?:เมตร|ม\.)/))) out.len = _num(m[1]);
    else if ((m = n.match(/ยาว\s*([\d.,]+)\s*ซม\./))) out.len = _num(m[1]) * 0.01;
    for (const k in out) if (!(out[k] > 0)) delete out[k];
    return out;
  }
  function unitOpts(unit, name) {
    const raw = String(unit || '').trim();
    const u = raw.toLowerCase();
    if (UNIT_TABLE[u]) return [{ dim: UNIT_TABLE[u][0], f: UNIT_TABLE[u][1] }];
    // หน่วยแบบมีจำนวน เช่น "144 แผ่น"
    const m = raw.match(/^([\d.,]+)\s*(\S+)$/);
    if (m && COUNT_UNITS.includes(m[2])) return [{ dim: 'count', f: _num(m[1]) }, { dim: 'u:' + raw, f: 1 }];
    // หน่วยบรรจุภัณฑ์/ชิ้น → ดูขนาดในชื่อ
    const c = pkgContents(name);
    const opts = [{ dim: 'u:' + raw, f: 1 }];
    if (COUNT_UNITS.includes(raw)) opts.push({ dim: 'count', f: 1 });
    for (const d in c) opts.push({ dim: d, f: c[d] });
    return opts;
  }
  function fmtQty(v, dim) {
    const u = { mass: 'กก.', vol: 'ลิตร', len: 'ม.', area: 'ตร.ม.', count: 'ชิ้น' }[dim] || '';
    return (+v.toFixed(4)) + ' ' + u;
  }
  // คืน {price, ok, how}
  function convertPrice(price, fromUnit, toUnit, fromName, toName) {
    if (price === null || price === undefined) return { price: null, ok: false, how: '' };
    const f = String(fromUnit || '').trim(), t = String(toUnit || '').trim();
    if (!f || !t || normUnit(f) === normUnit(t)) return { price, ok: true, how: '' };
    const A = unitOpts(f, fromName), B = unitOpts(t, toName);
    // ใช้หน่วยตรงก่อน แล้วค่อยมิติ มวล/ปริมาตร/ความยาว/พื้นที่/จำนวน
    const order = ['u:', 'mass', 'vol', 'len', 'area', 'count'];
    for (const key of order) {
      for (const a of A) for (const b of B) {
        if (a.dim !== b.dim) continue;
        if (key === 'u:' ? !a.dim.startsWith('u:') : a.dim !== key) continue;
        const v = price * b.f / a.f;
        const fa = (!UNIT_TABLE[f.toLowerCase()] && !a.dim.startsWith('u:') && a.f !== 1) ? ` (${fmtQty(a.f, a.dim)})` : '';
        const tb = (!UNIT_TABLE[t.toLowerCase()] && !b.dim.startsWith('u:') && b.f !== 1) ? ` (${fmtQty(b.f, b.dim)})` : '';
        return { price: v, ok: true, how: `${f}${fa} → ${t}${tb}` };
      }
    }
    return { price: null, ok: false, how: `แปลง ${f} → ${t} ไม่ได้` };
  }
  function splitCodes(s) {
    return String(s || '').split(/[,;\s]+/).map(x => x.replace(/^="?|"?$/g, '').trim()).filter(x => x.length > 5);
  }

  // ============================================================
  // SMART SEARCH — multi-word token + weighted scoring
  // ============================================================
  function tokenize(q) {
    return q.trim().toLowerCase().split(/[\s,]+/).map(t => t.trim()).filter(t => t.length >= 2);
  }
  // คืน score > 0 ถ้าตรงทุก token, 0 ถ้าพลาดแม้ token เดียว; fields = [{text, weight}]
  function score(tokens, fields) {
    if (!tokens.length) return 1;
    let total = 0;
    for (const tok of tokens) {
      let best = 0;
      for (const f of fields) {
        if (!f.text) continue;
        const t = f.text.toLowerCase();
        const wordStart = t === tok || t.startsWith(tok) || t.includes(' ' + tok) || t.includes('\t' + tok);
        if (wordStart) { best = Math.max(best, f.weight * 1.5); continue; }
        if (t.includes(tok)) best = Math.max(best, f.weight);
      }
      if (best === 0) return 0;
      total += best;
    }
    return total;
  }
  function filter(items, q, getFields, limit = 40) {
    const tokens = tokenize(q);
    if (!tokens.length) return [];
    const scored = [];
    for (const it of items) {
      const s = score(tokens, getFields(it));
      if (s > 0) scored.push({ it, s });
    }
    scored.sort((a, b) => b.s - a.s);
    return scored.slice(0, limit).map(x => x.it);
  }

  // ============================================================
  // DB — ฐานข้อมูลราคา
  // กำหนด materials / wages / matRef / compList / compItems ใหม่ได้ตลอด (เช่น หลังโหลดชีตใหม่)
  // ============================================================
  class DB {
    constructor(data = {}) {
      this.cats = data.cats || [];
      this.materials = data.materials || [];
      this.wages = data.wages || [];
      this.matRef = data.matRef || {};
      this.compList = data.compList || [];
      this.compItems = data.compItems || [];
    }
    // ---- วัสดุพาณิชย์ ----
    material(code) {
      return this.materials.find(d => d.code === code) || null;
    }
    get period() { return this.materials.length ? this.materials[0].period : ''; }
    // ---- mat_ref ----
    itemCodes(it) {
      const r = this.matRef[it.itemCode];
      return splitCodes(r && r.commodityCode ? r.commodityCode : it.commodityCode);
    }
    itemFullName(it) {
      const r = this.matRef[it.itemCode];
      return (it.itemName || '') + ' ' + (r ? r.name : '');
    }
    // รหัสพาณิชย์ตัวแรกที่มีราคา → {matItem, codes, missing}
    resolveMat(it) {
      const codes = this.itemCodes(it), missing = [];
      let matItem = null;
      for (const c of codes) {
        const m = this.material(c);
        if (m && m.price !== null) { matItem = m; break; }
        missing.push(c);
      }
      return { matItem, codes, missing };
    }
    // ---- ส่วนผสม ----
    comp(id) { return this.compList.find(c => c.id === String(id)) || null; }
    findComp(ref) {
      const v = String(ref || '').trim();
      if (!v) return null;
      return this.compList.find(c => c.id === v) || this.compList.find(c => c.sub === v) || null;
    }
    resolveCompRef(it) {
      const r = this.matRef[it.itemCode];
      return r ? this.findComp(r.compRef) : null;
    }
    itemsOf(compId) { return this.compItems.filter(d => d.compId === String(compId)); }

    /**
     * ราคาต่อหน่วยของวัสดุมวลรวม
     * opts.subPrices {compId: ราคา}  ราคาส่วนผสมที่ผู้ใช้คิดไว้แล้ว (ใช้ก่อนคำนวณเอง ทั้งตัวเองและส่วนผสมย่อย)
     * opts.qty       {index: ปริมาณ} ปริมาณที่เล่มเว้นว่าง (index = ลำดับแถวในส่วนผสม เริ่ม 0)
     * opts.prices    {index: ราคา}   ราคาที่ผู้ใช้กรอกเอง
     * opts.partial   true = ถ้าบางบรรทัดไม่มีราคา ให้รวมเฉพาะบรรทัดที่มี (complete=false, partial=true, missing=[index])
     * คืน {compId, unit, price (ปัด 2 ตำแหน่ง), raw, complete, source, lines[]}
     *   line.source: 'user' | 'fixed' | 'commerce' | 'commerce-fallback' | 'sub-comp' | null
     */
    compPrice(compId, opts = {}, _depth = 0) {
      const comp = typeof compId === 'object' ? compId : this.comp(compId);
      if (!comp) return null;
      const subPrices = opts.subPrices || {};
      if (subPrices[comp.id] !== undefined && subPrices[comp.id] !== null) {
        const p = subPrices[comp.id];
        return { compId: comp.id, unit: comp.unit, price: p, raw: p, complete: true, source: 'list', lines: [] };
      }
      if (_depth > CONFIG.MAX_SUB_DEPTH) {
        return { compId: comp.id, unit: comp.unit, price: null, raw: null, complete: false, source: 'auto', lines: [] };
      }
      const userQty = (_depth === 0 && opts.qty) || {};
      const userPrice = (_depth === 0 && opts.prices) || {};
      let total = 0, complete = true;
      const lines = this.itemsOf(comp.id).map((it, i) => {
        const line = {
          index: i, seq: it.seq, itemCode: it.itemCode, name: it.itemName, unit: it.unit,
          qty: it.qty, unitPrice: null, amount: null, source: null,
          province: '', commodityCode: '', how: '', warnings: [],
        };
        if (userQty[i] !== undefined && userQty[i] !== null && userQty[i] !== '') line.qty = +userQty[i];
        if (line.qty === null) { line.warnings.push('missing_qty'); complete = false; }

        let p = null;
        if (userPrice[i] !== undefined && userPrice[i] !== null && userPrice[i] !== '') {
          p = +userPrice[i]; line.source = 'user';
        } else if (it.fixedPrice !== null) {
          p = it.fixedPrice; line.source = 'fixed';
        } else {
          const { matItem, codes, missing } = this.resolveMat(it);
          if (matItem) {
            const cx = convertPrice(matItem.price, matItem.unit, it.unit, matItem.name, this.itemFullName(it));
            line.how = cx.how;
            line.commodityCode = matItem.code;
            line.province = matItem.province;
            if (cx.ok) { p = cx.price; line.source = missing.length ? 'commerce-fallback' : 'commerce'; }
            else line.warnings.push('unit_conversion_failed');
          } else {
            if (codes.length) line.warnings.push('no_commerce_price');
            const sc = this.resolveCompRef(it);
            if (sc && sc.id !== comp.id) {
              if (normUnit(sc.unit) === normUnit(it.unit)) {
                const r = this.compPrice(sc, { subPrices }, _depth + 1);
                if (r && r.price !== null) { p = r.price; line.source = 'sub-comp'; line.subComp = sc.sub || sc.id; }
              } else line.warnings.push('sub_comp_unit_mismatch');
            }
          }
        }
        if (p === null) { line.warnings.push('missing_price'); complete = false; }
        line.unitPrice = p;
        if (p !== null && line.qty !== null) { line.amount = line.qty * p; total += line.amount; }
        return line;
      });
      return {
        compId: comp.id, unit: comp.unit,
        price: (complete || opts.partial) ? round2(total) : null, raw: (complete || opts.partial) ? total : null,
        complete, partial: !complete && !!opts.partial,
        missing: lines.filter(l => l.warnings.includes('missing_price') || l.warnings.includes('missing_qty')).map(l => l.index),
        source: 'auto', lines,
      };
    }

    // ---- ค่าแรง ว480 ----
    wage(code) { return this.wages.find(w => w.code === code) || null; }

    // ---- ตรวจรหัสพาณิชย์ใน mat_ref ----
    // คืน {dead:[{key, ref, codes, suggestions}], fallback:[{key, ref, codes, used}]}
    checkCodes(suggestLimit = 3) {
      const dead = [], fallback = [];
      Object.entries(this.matRef).forEach(([key, r]) => {
        const codes = splitCodes(r.commodityCode);
        if (!codes.length) return;
        const okIdx = codes.findIndex(c => { const m = this.material(c); return m && m.price !== null; });
        if (okIdx < 0) dead.push({ key, ref: r, codes, suggestions: this.suggest(r.name, codes, suggestLimit) });
        else if (okIdx > 0) fallback.push({ key, ref: r, codes, used: codes[okIdx] });
      });
      return { dead, fallback };
    }
    // วัสดุพาณิชย์ที่มีราคาและชื่อใกล้เคียง
    suggest(name, excludeCodes = [], limit = 3) {
      const used = new Set(excludeCodes);
      const pool = this.materials.filter(x => x.price !== null && !used.has(x.code));
      const fields = x => [{ text: x.name, weight: 6 }, { text: x.catName, weight: 1 }];
      const q1 = String(name || '').replace(/\(.*?\)/g, ' ').replace(/\s+/g, ' ').trim();
      let sug = filter(pool, q1, fields, limit);
      if (!sug.length) sug = filter(pool, q1.split(' ')[0], fields, limit);
      return sug;
    }
  }

  // ============================================================
  // LOAD — ดึงทุกชีตแล้วคืน DB
  // ============================================================
  async function load(options = {}) {
    const f = options.fetch;
    const A = options.sheetId || CONFIG.SHEET_ID, B = options.compSheetId || CONFIG.COMP_SHEET_ID;
    const [catT, matT, refT, listT, itemT, ...wageT] = await Promise.all([
      fetchSheet(A, CONFIG.SH_CAT, f), fetchSheet(A, CONFIG.SH_DATA, f),
      fetchSheet(B, 'mat_ref', f), fetchSheet(B, 'comp_list', f), fetchSheet(B, 'comp_items', f),
      ...CONFIG.WAGE_SHEETS.map(ws => fetchSheet(A, ws.sheet, f)),
    ]);
    return new DB({
      cats: parse.cats(catT),
      materials: parse.materials(matT),
      matRef: parse.matRef(refT),
      compList: parse.compList(listT),
      compItems: parse.compItems(itemT),
      wages: wageT.flatMap((t, i) => parse.wages(t, CONFIG.WAGE_SHEETS[i])),
    });
  }

  return {
    VERSION, CONFIG, DB, load, parse,
    util: { cv, nv, round2, gvizURL, parseGviz, fetchSheet },
    units: { UNIT_TABLE, COUNT_UNITS, UNIT_ALIAS, normUnit, pkgContents, unitOpts, convertPrice, fmtQty, splitCodes },
    search: { tokenize, score, filter },
  };
});
