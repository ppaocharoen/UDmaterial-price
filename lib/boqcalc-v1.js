/* คัดลอกจาก UD-Total-Station lib/ เมื่อ 28 ต.ค. 2569 (เวอร์ชัน 1) — ตัวคิดราคา BOQ เดียวกับเว็บ BOQ; ถ้าแก้ผลคำนวณให้ทำไฟล์ -v2 ใหม่ */
/*! boqcalc.js — คิดราคาแถว BOQ จาก quantities ของ .bm.json ด้วยฐานราคา UDPrice (UD-Cost Hub lib/pricing-v1.js)
 *
 * กฎปัดเศษ (ตกลงกับ Earth 18 ต.ค. 2569): ปริมาณแต่ละแถวปัด 2 ตำแหน่ง (มาจากตัวถอดแล้ว), ราคาต่อหน่วยปัด 2 ตำแหน่ง,
 * จำนวนเงิน = ปริมาณ × ราคาต่อหน่วย แล้วปัด 2 ตำแหน่ง — ตัวเลขที่พิมพ์คูณกันได้ตรง
 * ใช้ได้ทั้งเบราว์เซอร์ (window.BoqCalc) และ Node
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.BoqCalc = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function r2(x) {
    if (x === null || x === undefined || !isFinite(x)) return x;
    const s = x < 0 ? -1 : 1;
    return s * Math.round(+(Math.abs(x) * 100).toFixed(6)) / 100;
  }

  // 1 จุด (ไฟฟ้า) = 1 ชุดอุปกรณ์ — ไลบรารีราคาไม่มีหน่วย "จุด"
  const conv = (U, price, fu, tu, fn, tn) => {
    if (tu === 'จุด') { const c = U.units.convertPrice(price, fu, 'ชุด', fn, tn); return c.ok ? Object.assign(c, { how: c.how ? c.how + ' · 1 จุด = 1 ชุด' : '' }) : c; }
    return U.units.convertPrice(price, fu, tu, fn, tn);
  };
  const sp = t => String(t || '').replace(/\s+/g, ' ').trim();
  // หาวัสดุในราคาพาณิชย์ตามชนิด/ขนาด (ตกลงกับ Earth 18 ต.ค. 2569: หลายยี่ห้อ → ถูกสุดที่มีราคาในอุดรธานี ถ้าอุดรไม่มี ใช้จังหวัดข้างเคียงที่ถูกสุด)
  function matchMat(f, m) {
    const n = sp(m.name);
    if (f.type === 'pvc_pipe') {
      if (!/ท่อ ?พีวีซี/.test(n) || !/ท่อประปา/.test(n) || !new RegExp('ชั้น ?' + f.cls.replace('.', '\\.') + '(\\s|$)').test(n)) return false;
      const d = n.match(/ศูนย์กลาง ?([0-9 \/]+?) ?(?:"|นิ้ว|”)/); return !!d && sp(d[1]) === sp(f.dia.replace(/["”]/g, ''));
    }
    if (f.type === 'thw') {
      if (!/THW/.test(n) || !/แกนเดี่ยว|1 ?[x×*] ?\d/.test(n)) return false;
      const d = n.match(/(?:1 ?[x×*] ?)?(\d+(?:\.\d+)?) ?ตร\.? ?มม/); return !!d && +d[1] === +f.size;
    }
    if (f.type === 're') return new RegExp(f.re).test(n);
    return false;
  }
  function findMat(db, U, f, row) {
    const pool = (db.materials || []).filter(m => m.price !== null && matchMat(f, m));
    if (!pool.length) return { price: null, src: '', warn: 'ไม่พบในราคาพาณิชย์ — กรอกราคาสืบ' };
    const at = m => { const u = (m.provinces || []).find(p => p.name === 'อุดรธานี'); return u && u.val !== null && u.val !== undefined ? { v: u.val, prov: 'อุดรธานี' } : null; };
    const udon = pool.filter(at), use = udon.length ? udon : pool;
    let best = null;
    use.forEach(m => { const pv = udon.length ? at(m) : { v: m.price, prov: m.province };
      const c = conv(U, pv.v, m.unit, row.unit, m.name, row.name); if (c.ok && (!best || c.price < best.price)) best = { price: c.price, m, prov: pv.prov, how: c.how }; });
    if (!best) return { price: null, src: '', warn: `หน่วยราคาพาณิชย์ (${pool[0].unit}) แปลงเป็น ${row.unit} ไม่ได้` };
    return { price: best.price, src: `พาณิชย์ ${best.m.code} ${best.prov} · ถูกสุดจาก ${use.length} รายการ${udon.length ? '' : ' (อุดรไม่มี)'}${best.how ? ' · ' + best.how : ''}`, pick: best.m.name };
  }

  /** ราคาวัสดุจาก price_ref: คืน {price, src, warn} ต่อหน่วยของแถว */
  function materialPrice(db, U, ref, row, subPrices) {
    if (ref && ref.kind === 'mat_find' && ref.find) return findMat(db, U, ref.find, row);
    if (ref && ref.need_mat && !ref.code) return { price: null, src: '', warn: 'ค่าวัสดุ: ' + (ref.why || 'ไม่มีในราคาพาณิชย์') + ' — กรอกราคาสืบ' };
    if (!ref || !ref.code) return { price: null, src: '', warn: '' };
    if (ref.kind === 'comp') {
      const comp = db.findComp(ref.code);
      if (!comp) return { price: null, src: '', warn: `ไม่พบวัสดุมวลรวม ${ref.code}` };
      const r = db.compPrice(comp.id, { subPrices, prices: ref.prices, partial: !!ref.partial });   /* ref.prices = ราคาที่ผู้ใช้กรอกให้บรรทัดที่ขาด (index → บาท/หน่วย) */
      if (r.price === null) return { price: null, src: `วัสดุมวลรวม ${comp.sub}`, warn: `วัสดุมวลรวม ${comp.sub} คิดไม่ครบ (ขาดราคา/ปริมาณบางรายการ)`, comp: r };
      if (U.units.normUnit(comp.unit) !== U.units.normUnit(row.unit)) {
        const cx = U.units.convertPrice(r.price, comp.unit, row.unit, comp.name, row.name);
        if (!cx.ok) return { price: null, src: `วัสดุมวลรวม ${comp.sub}`, warn: `หน่วยวัสดุมวลรวม ${comp.unit} ไม่ตรงกับ ${row.unit}` };
        return { price: cx.price, src: `วัสดุมวลรวม ${comp.sub} (${cx.how})${r.partial ? ' (ราคาไม่ครบ ผู้ใช้ยอมรับ)' : ''}`, comp: r };
      }
      return { price: r.price, src: `วัสดุมวลรวม ${comp.sub}${r.partial ? ' (ราคาไม่ครบ ผู้ใช้ยอมรับ)' : ''}`, comp: r };
    }
    if (ref.kind === 'mat') {
      const { matItem, missing } = db.resolveMat({ itemCode: '', commodityCode: ref.code });
      if (!matItem) return { price: null, src: '', warn: `รหัสพาณิชย์ ${ref.code} ไม่มีราคาเดือนนี้` };
      const cx = conv(U, matItem.price, matItem.unit, row.unit, matItem.name, row.name);
      if (!cx.ok) return { price: null, src: matItem.code, warn: cx.how };
      return { price: cx.price, src: `พาณิชย์ ${matItem.code} ${matItem.province}${missing.length ? ' (รหัสสำรอง)' : ''}${cx.how ? ' · ' + cx.how : ''}` };
    }
    return { price: null, src: '', warn: '' };
  }

  // ค่าแรงหลายรายการรวมกัน เช่น ประตู: ติดตั้งวงกบ (ต่อ ตร.ม.) + บาน (ต่อ ตร.ม.) + ลูกบิด (ต่อชุด) → ราคาต่อชุดของแถว
  function laborMulti(db, U, ref, row) {
    let sum = 0; const parts = [];
    for (const w of ref.wages) {
      const x = db.wage(w.code);
      if (!x || x.price === null) return { price: null, src: '', warn: `ไม่พบค่าแรง ${w.code}` };
      const v = w.per === 'area' ? x.price * (ref.area || 0) : x.price;
      sum += v; parts.push(`${w.code} ${x.price}${w.per === 'area' ? `×${ref.area}` : ''}`);
    }
    return { price: sum, src: 'ว480 ' + parts.join(' + ') };
  }
  function laborPrice(db, U, code, row) {
    if (!code) return { price: null, src: '' };
    const w = db.wage(code);
    if (!w || w.price === null) return { price: null, src: '', warn: `ไม่พบค่าแรง ${code}` };
    const cx = conv(U, w.price, w.unit, row.unit, '', row.name);
    if (!cx.ok) return { price: null, src: code, warn: `หน่วยค่าแรง ${w.unit} ไม่ตรงกับ ${row.unit}` };
    return { price: cx.price, src: `ว480 ${code}${cx.how ? ' · ' + cx.how : ''}` };
  }

  /**
   * คิดราคาทุกแถว
   * rows: quantities.items (+ แถวที่ผู้ใช้เพิ่ม)
   * state.overrides[key] = {mat, lab, code, wage_code, kind} ค่าที่ผู้ใช้แก้
   * คืน [{...row, mat_unit, mat_amt, lab_unit, lab_amt, total, mat_src, lab_src, warns[]}]
   */
  function priceRows(db, U, rows, state = {}) {
    const ov = state.overrides || {};
    const subPrices = state.subPrices || {};
    const out = rows.map(row0 => {
      const row = Object.assign({}, row0, { qty: r2(+row0.qty || 0) });   // จำนวนที่พิมพ์ (2 ตำแหน่ง) คือจำนวนที่ใช้คูณ
      if (row.price_ref && row.price_ref.kind === 'pct') return row;   // คิดรอบสอง (ต้องรู้ราคาแถวอ้างอิงก่อน)
      const o = ov[row.key] || {};
      const ref = Object.assign({}, row.price_ref || {}, o.kind ? { kind: o.kind } : {}, o.code !== undefined ? { code: o.code } : {},
        o.wage_code !== undefined ? { wage_code: o.wage_code } : {});
      const warns = [];
      let mat = { price: null, src: '' }, lab = { price: null, src: '' };
      if (db) {
        mat = materialPrice(db, U, ref, row, subPrices);
        lab = ref.wages ? laborMulti(db, U, ref, row) : laborPrice(db, U, ref.wage_code || (ref.kind === 'wage' ? ref.code : null), row);
        if (ref.kind === 'wage') mat = { price: null, src: 'ค่าแรงอย่างเดียว' };
      }
      // ผู้ใช้กด "ไม่มีค่าวัสดุ" (งานที่มีแต่ค่าแรง)
      if (o.no_mat) mat = { price: null, src: 'ไม่มีค่าวัสดุ (กำหนดเอง)' };
      const labOnly = ref.kind === 'wage' || !!o.no_mat;
      // ราคาสืบ (แท็บราคาสืบ): ใช้เมื่อไม่มีราคาพาณิชย์/วัสดุมวลรวม
      const sv = (state.survey || {})[row.key];
      if (sv && sv.price !== null && sv.price !== undefined && mat.price === null && !labOnly) mat = { price: sv.price, src: sv.src };
      if (lab.price === null && ref.no_lab) lab = { price: null, src: 'ไม่มีค่าแรงแยก: ' + ref.no_lab };   // ตั้งใจไม่มีค่าแรงแถวนี้
      // ค่าแรงคิดเป็น % ของค่าวัสดุต่อหน่วยของแถวเดียวกัน (เช่น หลักเกณฑ์ 30% ของค่าของ) — ใช้ราคาวัสดุหลังกรอกเอง
      const matFinal = (o.mat !== undefined && o.mat !== null && o.mat !== '') ? +o.mat : mat.price;
      if (ref.lab_pct !== undefined && ref.lab_pct !== null && ref.lab_pct !== '') {
        lab = matFinal === null ? { price: null, src: '' } : { price: r2(matFinal * ref.lab_pct), src: `${+(ref.lab_pct * 100).toFixed(2)}% ของค่าวัสดุ` };
      }
      if (o.mat !== undefined && o.mat !== null && o.mat !== '') mat = { price: +o.mat, src: 'กรอกเอง' };
      if (o.lab !== undefined && o.lab !== null && o.lab !== '') lab = { price: +o.lab, src: 'กรอกเอง' };
      if (mat.warn) warns.push(mat.warn);
      if (lab.warn) warns.push(lab.warn);
      const mu = mat.price === null ? null : r2(mat.price);
      const lu = lab.price === null ? null : r2(lab.price);
      const ma = mu === null ? 0 : r2(row.qty * mu);
      const la = lu === null ? 0 : r2(row.qty * lu);
      if (mu === null && lu === null && !(ref.no_lab && !ref.need_mat && !ref.code && !ref.find)) warns.push('ยังไม่มีราคา');
      // แถวจาก BOQ: ใส่ราคาด้านเดียวแล้ว อีกด้านที่ยังไม่ได้เลือก (และไม่ได้กด "ไม่มี...") ยังต้องเตือนค้างไว้
      if (ref.chk && !warns.includes('ยังไม่มีราคา')) {
        if (mu === null && !labOnly) warns.push('ยังไม่มีค่าวัสดุ');
        if (lu === null && !ref.lab_none) warns.push('ยังไม่มีค่าแรง');
      }
      return Object.assign({}, row, { ref, mat_unit: mu, mat_amt: ma, lab_unit: lu, lab_amt: la, total: r2(ma + la),
        mat_src: mat.src, lab_src: lab.src, lab_only: labOnly, warns });
    });
    // แถวคิดเป็น % ของแถวอื่น (ข้อต่อ/อุปกรณ์ยึดท่อ ตามหลักเกณฑ์ 2569 ข้อ 4.3 ข้อ 3.2–3.3)
    const byKey = Object.fromEntries(out.filter(r => r.mat_amt !== undefined).map(r => [r.key, r]));
    return out.map(row => {
      if (!(row.price_ref && row.price_ref.kind === 'pct')) return row;
      row = Object.assign({}, row, { qty: r2(+row.qty || 0) });
      const o = ov[row.key] || {}, pr = row.price_ref, warns = [];
      const refs = (pr.of || []).map(k => byKey[k]).filter(Boolean);
      const base = r2(refs.reduce((a, r) => a + (r.mat_amt || 0), 0));
      if (!(pr.of || []).length) warns.push('ยังไม่ได้เลือกรายการที่ใช้เป็นฐานคิดเปอร์เซ็นต์');
      else if (refs.length < pr.of.length) warns.push('รายการฐานคิดเปอร์เซ็นต์บางรายการถูกลบไปแล้ว — กรุณาเลือกรายการฐานใหม่');
      if (refs.some(r => r.mat_unit === null)) warns.push('รายการฐานบางรายการยังไม่มีราคา — ค่าที่คิดเป็นเปอร์เซ็นต์ยังไม่ครบ');
      const baseTxt = base.toLocaleString('en-US', { minimumFractionDigits: 2 });
      let mu = r2(base * pr.mat), ms = `${+(pr.mat * 100).toFixed(2)}% ของ${pr.of_label || 'ค่าวัสดุของรายการที่เลือก'} ${baseTxt} (${pr.of_txt || refs.length + ' รายการ'})`;
      let lu = null, ls = '';
      if (pr.lab_none) { ls = 'ไม่มีค่าแรง'; }
      else if (pr.lab_pct !== undefined && pr.lab_pct !== null && pr.lab_pct !== '') { lu = r2(mu * pr.lab_pct); ls = `${+(pr.lab_pct * 100).toFixed(2)}% ของค่าวัสดุ`; }
      else if (pr.lab_of_mat !== undefined) { lu = r2(mu * pr.lab_of_mat); ls = `${+(pr.lab_of_mat * 100).toFixed(2)}% ของค่าวัสดุ`; }
      if (o.mat !== undefined && o.mat !== null && o.mat !== '') { mu = r2(+o.mat); ms = 'กรอกเอง'; }
      if (o.lab !== undefined && o.lab !== null && o.lab !== '') { lu = r2(+o.lab); ls = 'กรอกเอง'; }
      if (lu === null && !pr.lab_none && !warns.length) warns.push('ยังไม่มีค่าแรง');
      const ma = r2(row.qty * mu), la = lu === null ? 0 : r2(row.qty * lu);
      return Object.assign({}, row, { ref: pr, mat_unit: mu, mat_amt: ma, lab_unit: lu, lab_amt: la, total: r2(ma + la), mat_src: ms, lab_src: ls, warns });
    });
  }

  function sumBy(rows, key) {
    const out = {};
    rows.forEach(r => { const k = r[key] || ''; out[k] = r2((out[k] || 0) + r.total); });
    return out;
  }

  // ---------------------------------------------------------------- จำนวนเงินเป็นตัวอักษร
  const D = ['', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
  const P = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];
  function readInt(n) {
    if (n === 0) return '';
    if (n >= 1e6) {
      const hi = Math.floor(n / 1e6), lo = n % 1e6;
      return readInt(hi) + 'ล้าน' + readInt(lo);
    }
    const s = String(n); let out = '';
    for (let i = 0; i < s.length; i++) {
      const d = +s[i], pos = s.length - i - 1;
      if (d === 0) continue;
      if (pos === 1 && d === 1) out += 'สิบ';
      else if (pos === 1 && d === 2) out += 'ยี่สิบ';
      else if (pos === 0 && d === 1 && s.length > 1) out += 'เอ็ด';
      else out += D[d] + P[pos];
    }
    return out;
  }
  function bahtText(x) {
    x = r2(x);
    if (x === 0) return 'ศูนย์บาทถ้วน';
    const neg = x < 0; x = Math.abs(x);
    const baht = Math.floor(x + 1e-9), satang = Math.round((x - baht) * 100);
    let t = (baht ? readInt(baht) + 'บาท' : '') + (satang ? readInt(satang) + 'สตางค์' : 'ถ้วน');
    return (neg ? 'ลบ' : '') + t;
  }

  return { r2, priceRows, materialPrice, laborPrice, sumBy, bahtText };
});
