/*! takeoff-v1.js — ใบถอดปริมาณ (รายการคำนวณปริมาณงาน) ของ UD-Cost Hub
 *
 * ข้อมูลต่อโครงการ p.boq.takeoff = {groups:[{id, name, note, dest, vars:[{n, e}], lines:[{id, label, e, dia, row}]}]}
 *   - กลุ่ม = องค์อาคาร/ส่วนงาน (เช่น "คาน B1 ชั้น 1") · dest = รหัสหมวด BOQ ปลายทาง
 *   - vars = ค่าที่วัดจากแบบ (สูตรอ้างค่าก่อนหน้าในกลุ่มเดียวกันได้)
 *   - lines = บรรทัดผลลัพธ์ · row = key รายการ BOQ ที่ส่งเข้า · dia > 0 = บรรทัดเหล็กเสริม (สูตรให้ความยาว ม. แล้วคูณ กก./ม.)
 *     st = {key, name, kgm} = บรรทัดเหล็กรูปพรรณ (สูตรให้ความยาว ม.) — key จาก steeltab-v1.js หรือ 'custom'
 * ปริมาณรายการ BOQ = ปัด 2 ตำแหน่ง( ผลรวมสุทธิทุกบรรทัด × (1 + % เผื่อ/100) ) — % เผื่อเก็บที่รายการ BOQ (r.waste)
 *   ยกเว้นเหล็กรูปพรรณ: แยกตามหน้าตัด ยาวรวม × (1 + % เผื่อ) ÷ 6 ม. ปัดเป็นท่อน (เศษ < 0.5 ปัดลง ≥ 0.5 ปัดขึ้น หลักเกณฑ์ 6.2
 *   มีความยาวแต่ปัดได้ 0 → 1 ท่อน) × 6 × กก./ม. — เดียวกับโครงหลังคาใน Total Station (เผื่อ 3% · หลังคาปั้นหยา 5%)
 * กติกาเดียวกับ UD Total Station tools/takeoff.py: วัดตามแบบ ไม่คิดระยะทาบ แล้วคูณ % เผื่อ · บรรทัดย่อยไม่ปัด
 * สูตรอ่านด้วยตัวแยกคำของไฟล์นี้เอง (ไม่ใช้ eval): ตัวเลข + − × ÷ * / ( ) ชื่อค่า และ ceil floor round min max sqrt abs
 * ใช้ได้ทั้งเบราว์เซอร์ (window.Takeoff) และ Node
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.Takeoff = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function r2(x) {
    if (x === null || x === undefined || !isFinite(x)) return x;
    const s = x < 0 ? -1 : 1;
    return s * Math.round(+(Math.abs(x) * 100).toFixed(6)) / 100;
  }
  // น้ำหนักเหล็กเสริม กก./ม. = d²/162 (เดียวกับ Total Station) · % เผื่อตามขนาด หลักเกณฑ์ 2569 ข้อ 4.1 (4)
  const kgm = d => d * d / 162;
  const REBAR_WASTE = { 6: 5, 9: 7, 10: 7, 12: 9, 15: 11, 16: 11, 19: 13, 20: 13, 22: 15, 25: 15, 28: 15, 32: 15 };
  const RB_SIZES = [6, 9];
  const REBAR_SIZES = [6, 9, 10, 12, 16, 20, 25, 28, 32];
  const rebarWaste = d => REBAR_WASTE[d] !== undefined ? REBAR_WASTE[d] : 15;
  const STEEL_PIECE = 6, STEEL_WASTE = 3;
  const steelPieces = (len, waste) => { if (!(len > 0)) return 0; return Math.max(1, Math.floor(+(len * (1 + (+waste || 0) / 100) / STEEL_PIECE).toFixed(9) + 0.5)); };
  const isSteel = l => !!(l && l.st && +l.st.kgm > 0);
  const rebarName = d => (RB_SIZES.includes(+d) ? 'RB' : 'DB') + d;
  const FN = { ceil: Math.ceil, floor: Math.floor, round: x => Math.round(x), min: Math.min, max: Math.max, sqrt: Math.sqrt, abs: Math.abs };
  const NAME_RE = /^[A-Za-z_ก-ฮ][A-Za-z0-9_฀-๿]*$/;

  /** ตัวเลขสำหรับแสดงในวิธีคิด: ไม่เกิน 3 ตำแหน่ง ตัดศูนย์ท้าย */
  function fnum(v) {
    if (!isFinite(v)) return String(v);
    const s = (Math.round(v * 1000) / 1000).toFixed(3).replace(/\.?0+$/, '');
    return s === '-0' ? '0' : s;
  }

  function tokenize(src) {
    const t = [], s = String(src == null ? '' : src);
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (/\s/.test(c)) { i++; continue; }
      const num = /^(\d+(?:\.\d*)?|\.\d+)/.exec(s.slice(i));
      if (num) { t.push({ k: 'n', v: +num[1], s: num[1] }); i += num[1].length; continue; }
      const nm = /^[A-Za-z_ก-ฮ][A-Za-z0-9_฀-๿]*/.exec(s.slice(i));
      if (nm) { t.push({ k: 'id', v: nm[0] }); i += nm[0].length; continue; }
      if ('+-−–'.includes(c)) { t.push({ k: 'op', v: c === '+' ? '+' : '-' }); i++; continue; }
      if (c === '*' || c === '×') { t.push({ k: 'op', v: '*' }); i++; continue; }
      if ('/÷'.includes(c)) { t.push({ k: 'op', v: '/' }); i++; continue; }
      if ('()'.includes(c)) { t.push({ k: c }); i++; continue; }
      if (c === ',') { t.push({ k: ',' }); i++; continue; }
      throw new Error('ตัวอักษร "' + c + '" ใช้ในสูตรไม่ได้');
    }
    return t;
  }

  /** คิดสูตร: คืน {v, txt} · txt = สูตรที่แทนชื่อค่าด้วยตัวเลข (ใช้แสดงวิธีคิด) · ผิดพลาด → throw */
  function evaluate(src, env) {
    const t = tokenize(src);
    if (!t.length) throw new Error('ยังไม่มีสูตร');
    let p = 0;
    const peek = () => t[p], eat = k => { const x = t[p]; if (!x || (k && x.k !== k)) throw new Error('สูตรไม่ครบหรือวงเล็บไม่ตรงกัน'); p++; return x; };
    const OP = { '+': ' + ', '-': ' − ', '*': ' × ', '/': ' ÷ ' };
    function expr() {
      let a = term();
      while (peek() && peek().k === 'op' && (peek().v === '+' || peek().v === '-')) {
        const o = eat().v, b = term();
        a = { v: o === '+' ? a.v + b.v : a.v - b.v, txt: a.txt + OP[o] + b.txt };
      }
      return a;
    }
    function term() {
      let a = unary();
      while (peek() && peek().k === 'op' && (peek().v === '*' || peek().v === '/')) {
        const o = eat().v, b = unary();
        if (o === '/' && b.v === 0) throw new Error('หารด้วยศูนย์');
        a = { v: o === '*' ? a.v * b.v : a.v / b.v, txt: a.txt + OP[o] + b.txt };
      }
      return a;
    }
    function unary() {
      if (peek() && peek().k === 'op' && peek().v === '-') { eat(); const a = unary(); return { v: -a.v, txt: '−' + a.txt }; }
      if (peek() && peek().k === 'op' && peek().v === '+') { eat(); return unary(); }
      return atom();
    }
    function atom() {
      const x = peek();
      if (!x) throw new Error('สูตรไม่ครบ');
      if (x.k === 'n') { eat(); return { v: x.v, txt: fnum(x.v) }; }
      if (x.k === '(') { eat(); const a = expr(); eat(')'); return { v: a.v, txt: '(' + a.txt + ')' }; }
      if (x.k === 'id') {
        eat();
        if (peek() && peek().k === '(') {
          const f = FN[x.v];
          if (!f) throw new Error('ไม่รู้จักฟังก์ชัน ' + x.v);
          eat('('); const args = [expr()];
          while (peek() && peek().k === ',') { eat(); args.push(expr()); }
          eat(')');
          return { v: f.apply(null, args.map(a => a.v)), txt: x.v + '(' + args.map(a => a.txt).join(', ') + ')' };
        }
        if (x.v === 'pi') return { v: Math.PI, txt: 'π' };
        if (!env || !Object.prototype.hasOwnProperty.call(env, x.v)) throw new Error('ไม่มีค่า "' + x.v + '" ในกลุ่มนี้');
        const v = env[x.v];
        if (v === null || v === undefined || !isFinite(v)) throw new Error('ค่า "' + x.v + '" ยังคิดไม่ได้');
        return { v, txt: fnum(v) };
      }
      throw new Error('สูตรไม่ถูกต้อง');
    }
    const out = expr();
    if (p < t.length) throw new Error('สูตรไม่ถูกต้อง (เกินมาหลัง "' + (t[p - 1] ? (t[p - 1].s || t[p - 1].v || t[p - 1].k) : '') + '")');
    if (!isFinite(out.v)) throw new Error('ผลไม่ใช่ตัวเลข');
    return out;
  }
  /** สูตรเป็นตัวเลขเดี่ยวหรือไม่ (ไม่ต้องแสดงวิธีคิดซ้ำ) */
  const isPlain = src => /^\s*\d+(?:\.\d*)?\s*$/.test(String(src || ''));

  /** คิดทั้งกลุ่ม: {vars:[{n,v,err,txt}], lines:[{id,v,len,kgm,err,txt,calc}], env} */
  function evalGroup(g) {
    const env = {}, vars = [], lines = [];
    (g.vars || []).forEach(x => {
      const n = String(x.n || '').trim();
      const o = { n, v: null, err: '', txt: '' };
      if (!n) o.err = 'ยังไม่มีชื่อค่า';
      else if (!NAME_RE.test(n)) o.err = 'ชื่อค่าต้องขึ้นต้นด้วยตัวอักษร ไม่มีเว้นวรรค';
      else if (FN[n] || n === 'pi') o.err = 'ชื่อนี้ใช้เป็นชื่อฟังก์ชัน';
      else if (Object.prototype.hasOwnProperty.call(env, n)) o.err = 'ชื่อค่าซ้ำในกลุ่ม';
      if (!o.err) { try { const r = evaluate(x.e, env); o.v = r.v; o.txt = r.txt; } catch (e) { o.err = e.message; } }
      if (n && !o.err) env[n] = o.v; else if (n && !Object.prototype.hasOwnProperty.call(env, n)) env[n] = null;
      vars.push(o);
    });
    (g.lines || []).forEach(l => {
      const o = { id: l.id, v: null, err: '', txt: '', calc: '' };
      try {
        const r = evaluate(l.e, env);
        if (l.st && !isSteel(l)) throw new Error(l.st.type === 'custom' || l.st.key === 'custom' ? 'ยังไม่ระบุ กก./ม. ของเหล็กรูปพรรณ' : 'ยังไม่เลือกขนาดเหล็กรูปพรรณ');
        if (isSteel(l)) {
          const k = +l.st.kgm;
          o.len = r.v; o.kgm = k; o.v = r.v * k; o.steel = { key: l.st.key || 'custom', name: String(l.st.name || '').trim() || 'เหล็กรูปพรรณ', kgm: k };
          o.calc = (isPlain(l.e) ? '' : r.txt + ' = ') + 'ยาว ' + fnum(r.v) + ' ม. (' + o.steel.name + ' ' + fnum(k) + ' กก./ม.)';
        } else if (+l.dia > 0) {
          const k = kgm(+l.dia);
          o.len = r.v; o.kgm = k; o.v = r.v * k;
          o.calc = (isPlain(l.e) ? '' : r.txt + ' = ') + fnum(r.v) + ' ม. × ' + k.toFixed(3) + ' กก./ม. = ' + fnum(o.v) + ' กก.';
        } else {
          o.v = r.v;
          o.calc = isPlain(l.e) ? fnum(r.v) : r.txt + ' = ' + fnum(r.v);
        }
        o.txt = r.txt;
      } catch (e) { o.err = e.message; }
      lines.push(o);
    });
    return { vars, lines, env };
  }

  /** รวมตามรายการ BOQ: {rowKey: {net, n, errs, items:[{gid, part, lid, label, calc, net, err}]}} */
  function rowTotals(tk) {
    const out = {};
    ((tk && tk.groups) || []).forEach(g => {
      const ev = evalGroup(g), part = String(g.name || '').trim() + (String(g.note || '').trim() ? ' (' + String(g.note).trim() + ')' : '');
      (g.lines || []).forEach((l, i) => {
        if (!l.row) return;
        const x = ev.lines[i], o = out[l.row] || (out[l.row] = { net: 0, n: 0, errs: 0, items: [], steel: {}, plain: 0 });
        const bad = !!x.err || ev.vars.some(v => v.err);
        o.items.push({ gid: g.id, part: part || '(ไม่มีชื่อกลุ่ม)', lid: l.id, label: String(l.label || '').trim() || (x.steel ? x.steel.name : l.dia ? 'เหล็ก ' + rebarName(l.dia) : ''), calc: x.calc, net: x.err ? null : x.v, len: x.err ? null : x.len, steel: !!x.steel, err: x.err || (bad ? 'ค่าในกลุ่มผิดพลาด' : '') });
        o.n++;
        if (x.err) o.errs++;
        else {
          o.net += x.v;
          if (x.steel) { const s = o.steel[x.steel.key + '|' + x.steel.kgm] || (o.steel[x.steel.key + '|' + x.steel.kgm] = { name: x.steel.name, kgm: x.steel.kgm, len: 0 }); s.len += x.len; }
          else o.plain += x.v;
        }
      });
    });
    return out;
  }
  const rowQty = (net, waste) => r2(net * (1 + (+waste || 0) / 100));
  /** เหล็กรูปพรรณของรายการ แยกตามหน้าตัด: [{name, kgm, len, lenW, pieces, kg}] */
  const steelBreak = (t, waste) => Object.keys((t && t.steel) || {}).map(k => {
    const s = t.steel[k], p = steelPieces(s.len, waste);
    return { name: s.name, kgm: s.kgm, len: s.len, lenW: s.len * (1 + (+waste || 0) / 100), pieces: p, kg: p * STEEL_PIECE * s.kgm };
  });
  /** ปริมาณรายการจากผลรวม (rowTotals): บรรทัดทั่วไป × (1 + เผื่อ) + เหล็กรูปพรรณเป็นท่อน */
  const rowQtyT = (t, waste) => {
    if (!t) return 0;
    const sb = steelBreak(t, waste);
    if (!sb.length) return rowQty(t.net, waste);
    return r2((t.plain || 0) * (1 + (+waste || 0) / 100) + sb.reduce((a, s) => a + s.kg, 0));
  };

  return { r2, fnum, kgm, STEEL_PIECE, STEEL_WASTE, steelPieces, steelBreak, rowQtyT, isSteel, REBAR_WASTE, REBAR_SIZES, rebarWaste, rebarName, tokenize, evaluate, evalGroup, rowTotals, rowQty, NAME_RE };
});
