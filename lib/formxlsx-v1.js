/* ที่มา: UD-Total-Station lib/formxlsx.js (คัดลอกมาใช้ใน Cost Hub) — แก้เพิ่ม: g.noHeader = กลุ่มที่ไม่พิมพ์แถวหัวกลุ่ม (รายการอยู่ใต้หมวดหลักโดยตรง) */
/*! formxlsx.js — ส่งออก BOQ เป็น Excel ตามแบบฟอร์มหน่วยงาน (ปร.1, ปร.1 (ก), ปร.2, ปร.2(ก), ปร.3, ปร.4, Factor F)
 * แม่แบบ: boq/form_template.xlsx (ทำจากไฟล์ ประมาณราคา_เสาธง ท12 — คงหัวกระดาษ ฟอนต์ เส้น ตั้งค่าหน้ากระดาษ ล้างข้อมูลและมาโคร)
 * ตัวเลขเป็นสูตร: จำนวน×ราคาปัด 2 ตำแหน่ง (เหมือนเว็บ) ผลรวม Factor F คิดเพียง — แก้ใน Excel แล้วคำนวณใหม่
 * ใช้ได้ทั้งเบราว์เซอร์ (window.ExcelJS) และ Node (require('exceljs'))
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.FormXlsx = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const COLS = 'ABCDEFGHIJKLMNO'.split('');
  const clone = o => o ? JSON.parse(JSON.stringify(o)) : {};
  /** เก็บรูปแบบแถวต้นแบบ {height, cells: {A: style…}} */
  function proto(ws, r, cols = COLS) {
    const row = ws.getRow(r), cells = {};
    cols.forEach(c => { cells[c] = clone(row.getCell(c).style); });
    return { height: row.height, cells };
  }
  function put(ws, r, p, vals = {}, cols = COLS) {
    const row = ws.getRow(r);
    if (p.height) row.height = p.height;
    cols.forEach(c => { const cell = row.getCell(c); cell.style = clone(p.cells[c]); cell.value = vals[c] === undefined ? null : vals[c]; });
    return row;
  }
  const f = (formula, result) => (result === undefined ? { formula } : { formula, result });
  /** ลงนาม: ผู้ประมาณราคา 1 ช่อง · คณะกรรมการเรียงแนวนอน slots ต่อบรรทัด (ชื่อ/ตำแหน่ง 2 แถว เว้น 1) — คืนแถวถัดไป */
  function sigs(ws, r0, slots, list, p1, p2, cols, nameOf, roleOf) {
    let r = r0;
    for (let i = 0; i < list.length; i += slots.length) {
      put(ws, r, p1, {}, cols); put(ws, r + 1, p2, {}, cols);
      list.slice(i, i + slots.length).forEach((x, k) => {
        const [a, b] = slots[k], t = slots[slots.length - 1][0];   // ใช้ฟอนต์ช่องลงนามเดิมของแม่แบบทุกช่อง
        [[r, nameOf(x), p1], [r + 1, roleOf(x), p2]].forEach(([rr, v, pp]) => {
          const c = ws.getCell(`${a}${rr}`); c.value = v; if (pp.cells[t] && pp.cells[t].font) c.font = clone(pp.cells[t].font); c.numFmt = 'General';
          c.alignment = Object.assign({}, c.alignment, { horizontal: 'center', vertical: 'middle', wrapText: false });
          if (a !== b) { try { ws.mergeCells(`${a}${rr}:${b}${rr}`); } catch (e) { /* ซ้อน */ } }
        });
      });
      r += 3;
    }
    return r;
  }


  /** ชีต "ที่มาของราคา": ที่มาของราคาที่ใช้ใน BOQ + ข้อมูลราคาที่ Backup ไว้ในโครงการ — A4 แนวนอน ฟอนต์เดียวกับชีตอื่น
   *  S: {commerce:[{code,name,unit,price,province,cat,period,used:[]}], materials, wages, comps, surveys}
   *  ตัดหน้าให้ "วัสดุ/มวลรวม/ราคาสืบหนึ่งรายการ" อยู่หน้าเดียวกัน (ใส่ page break ก่อนบล็อกที่จะล้นหน้า) */
  function sourcesSheet(wb, P, S, dateText) {
    const ws = wb.addWorksheet('ที่มาของราคา', {
      views: [{ showGridLines: false }],
      pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
        margins: { left: 0.2362204724409449, right: 0.2362204724409449, top: 0.7480314960629921, bottom: 0.7480314960629921, header: 0.3149606299212598, footer: 0.3149606299212598 } }
    });
    ws.headerFooter.oddHeader = '&C&G';   // ลายน้ำ (ใส่รูปภายหลังโดย xlsxwm)
    [6.5, 36, 8, 12, 13, 14, 26, 15.5].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    const FN = 'TH Sarabun New', B = { style: 'thin' }, BD = { top: B, left: B, bottom: B, right: B };
    const GREY = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } }, GREY2 = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7E6E6' } }, PICK = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDEDED' } };
    const NUM = '#,##0.00##', PAGE_H = 455;   // ความสูงที่ใช้ได้ต่อหน้า (pt) แบบเผื่อไว้
    let r = 1, lastBrk = 0; const hs = {};
    const cell = (c1, c2, v, o = {}) => {
      const row = ws.getRow(r); row.height = o.h || ROW_H; hs[r] = row.height;
      for (let c = c1; c <= c2; c++) {
        const x = row.getCell(c);
        x.font = { name: FN, size: o.size || 13, bold: !!o.bold };
        x.alignment = { horizontal: o.al || 'left', vertical: 'middle', wrapText: !!o.wrap, indent: (o.al || 'left') === 'left' && o.border ? 1 : 0 };
        if (o.border) x.border = BD;
        if (o.fill) x.fill = o.fill;
      }
      const x = row.getCell(c1); x.value = v === undefined ? null : v; if (o.fmt) x.numFmt = o.fmt;
      if (o.link && v) { x.value = { text: String(v), hyperlink: o.link }; x.font = { name: FN, size: o.size || 13, underline: true, color: { argb: 'FF0563C1' } }; }
      if (c2 > c1) ws.mergeCells(r, c1, r, c2);
    };
    // ลิงก์ยาว → แสดงชื่อโดเมน + เลขอ้างอิง [n] (คลิกได้) · ลิงก์เต็มเรียงในตารางเอกสารอ้างอิงท้ายชีต
    const refs = [];
    const URL_RE = /(?:https?:\/\/|www\.)[^\s<>"']+/gi;
    const shorten = (text, who) => {
      let first = null;
      const out = String(text || '').replace(URL_RE, m => {
        const url = m.replace(/[.,;:)\]]+$/, ''), tail = m.slice(url.length), full = /^https?:/i.test(url) ? url : 'https://' + url;
        let host = url.replace(/^https?:\/\//i, '').split(/[\/?#]/)[0].replace(/^www\./i, '');
        let i = refs.findIndex(x => x.url === full); if (i < 0) { refs.push({ url: full, used: [] }); i = refs.length - 1; }
        if (who && !refs[i].used.includes(who)) refs[i].used.push(who);
        if (!first) first = full;
        return `${host} [${i + 1}]${tail}`;
      });
      return { text: out, link: first };
    };
    const wrapH = (txt, cap) => Math.max(1, Math.ceil(vwid(txt) / cap));
    /** เหลือที่ในหน้าปัจจุบันพอสำหรับบล็อกสูง h ไหม — ถ้าไม่พอ ตัดหน้าก่อนบล็อก (บล็อกสูงเกินหน้าไม่ต้องตัด) */
    const need = h => {
      let used = 0; for (let k = lastBrk + 1; k < r; k++) used += hs[k] || ROW_H;
      if (used > 0 && used + h > PAGE_H && h <= PAGE_H) { ws.getRow(r - 1).addPageBreak(); lastBrk = r - 1; }
    };
    const rowH = (...pairs) => ROW_H * Math.max(1, ...pairs.map(([t, cap]) => wrapH(t, cap)));
    const hdr = list => { list.forEach(([c1, c2, t]) => cell(c1, c2, t, { bold: true, al: 'center', border: true, fill: GREY2 })); r++; };
    const sec = t => { cell(1, 8, t, { bold: true, size: 14, fill: GREY, border: true }); r++; };
    const num = v => (v === null || v === undefined || v === '' || isNaN(+v)) ? null : +v;
    const money = v => (+v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    cell(1, 8, 'ที่มาของราคา', { bold: true, size: 18, al: 'center', h: 27 }); r++;
    cell(1, 8, P.name || '', { bold: true, size: 14, al: 'center' }); r++;
    cell(1, 8, 'ที่มาของราคาที่ใช้ใน BOQ และข้อมูลราคาที่เก็บไว้ (Backup) ในโครงการ' + (dateText ? '  ·  ณ วันที่ ' + dateText : ''), { al: 'center' }); r++;
    r++;
    const any = ['commerce', 'wagesUsed', 'materials', 'wages', 'comps', 'surveys'].reduce((a, k) => a + (S[k] || []).length, 0);
    if (!any) { cell(1, 8, 'โครงการนี้ยังไม่มีข้อมูลราคาที่ Backup ไว้ (ราคาวัสดุ ค่าแรง วัสดุมวลรวม ราคาสืบ)', { al: 'center' }); r++; }
    let secNo = 0;

    // ราคาพาณิชย์จังหวัดที่ BOQ ผูกไว้ (ดึงจากฐานข้อมูลพาณิชย์ ไม่ต้องรอ Backup)
    if ((S.commerce || []).length) {
      const per = (S.commerce.find(x => x.period) || {}).period;
      need(ROW_H * 7);
      sec(`${++secNo}. ราคาวัสดุจากราคากลางพาณิชย์จังหวัด ที่ใช้ใน BOQ (${S.commerce.length} รายการ)${per ? ' · ' + per : ''}`);
      hdr([[1, 1, 'ลำดับ'], [2, 2, 'รายการวัสดุ (รหัส)'], [3, 3, 'หน่วย'], [4, 6, 'ราคา/หน่วย (บาท)'], [7, 7, 'ใช้ในรายการ'], [8, 8, 'จังหวัดที่ใช้']]);
      S.commerce.forEach((m, i) => {
        const nm = `${m.name}${m.code ? '  (' + m.code + ')' : ''}`, us = (m.used || []).slice(0, 2).join(', ') + ((m.used || []).length > 2 ? ` และอีก ${m.used.length - 2} รายการ` : '');
        const h = rowH([nm, 32], [us, 19], [m.province, 12]);
        if (i === 0) need(h * 2);
        cell(1, 1, i + 1, { al: 'center', border: true, h });
        cell(2, 2, nm, { border: true, wrap: true, h });
        cell(3, 3, m.unit || '', { al: 'center', border: true, h });
        cell(4, 6, num(m.price), { al: 'right', border: true, fmt: NUM, h });
        cell(7, 7, us, { border: true, wrap: true, h });
        cell(8, 8, m.province || '', { al: 'center', border: true, wrap: true, h }); r++;
      });
      r++;
    }
    // วัสดุมวลรวม — หนึ่งใบต่อหนึ่งบล็อก ไม่ตัดกลางใบ
    if ((S.comps || []).length) {
      need(ROW_H * 5 + ROW_H * 1.5 * ((S.comps[0].lines || []).length || 1));
      sec(`${++secNo}. วัสดุมวลรวม (${S.comps.length} รายการ)`);
      S.comps.forEach(c => {
        const ls = c.lines || [], hh = ls.map(l => rowH([l.name, 32], [l.src, 30]));
        need(ROW_H * 3 + hh.reduce((a, b) => a + b, 0) + ROW_H);
        cell(1, 5, c.title, { bold: true, border: true, fill: GREY2 });
        cell(6, 8, `รวม ${c.total === null || c.total === undefined ? '-' : money(c.total)} บาท/${c.unit || 'หน่วย'}`, { bold: true, al: 'right', border: true, fill: GREY2 }); r++;
        hdr([[1, 1, 'ลำดับ'], [2, 2, 'รายการวัสดุ'], [3, 3, 'หน่วย'], [4, 4, 'ปริมาณ'], [5, 5, 'ราคา/หน่วย'], [6, 6, 'รวม (บาท)'], [7, 8, 'ที่มาของราคา']]);
        ls.forEach((l, k) => {
          const h = hh[k];
          cell(1, 1, k + 1, { al: 'center', border: true, h });
          cell(2, 2, l.name, { border: true, wrap: true, h });
          cell(3, 3, l.unit || '', { al: 'center', border: true, h });
          cell(4, 4, num(l.qty), { al: 'right', border: true, fmt: NUM, h });
          cell(5, 5, num(l.price) ? num(l.price) : null, { al: 'right', border: true, fmt: NUM, h });
          cell(6, 6, num(l.amount) ? num(l.amount) : null, { al: 'right', border: true, fmt: NUM, h });
          cell(7, 8, l.src || '', { border: true, wrap: true, h }); r++;
        });
        r++;
      });
    }
    // ค่าแรง (ว.480) ที่ใช้ใน BOQ
    if ((S.wagesUsed || []).length) {
      need(ROW_H * 7);
      sec(`${++secNo}. ค่าแรงจากบัญชีค่าแรง (ว.480) ที่ใช้ใน BOQ (${S.wagesUsed.length} รายการ)`);
      hdr([[1, 1, 'ลำดับ'], [2, 2, 'รายการงาน (รหัส)'], [3, 3, 'หน่วย'], [4, 6, 'ค่าแรง/หน่วย (บาท)'], [7, 8, 'หมวด / ใช้ในรายการ']]);
      S.wagesUsed.forEach((w, i) => {
        const nm = `${w.name}${w.code ? '  (' + w.code + ')' : ''}`, us = (w.used || []).slice(0, 2).join(', ') + ((w.used || []).length > 2 ? ` และอีก ${w.used.length - 2} รายการ` : '');
        const info = `${w.path || ''}${w.path && us ? '  |  ' : ''}${us ? 'ใช้ใน: ' + us : ''}`;
        const h = rowH([nm, 32], [info, 27]);
        if (i === 0) need(h * 2);
        cell(1, 1, i + 1, { al: 'center', border: true, h });
        cell(2, 2, nm, { border: true, wrap: true, h });
        cell(3, 3, w.unit || '', { al: 'center', border: true, h });
        cell(4, 6, num(w.price), { al: 'right', border: true, fmt: NUM, h });
        cell(7, 8, info, { border: true, wrap: true, h }); r++;
      });
      r++;
    }
    // ราคาสืบ — หนึ่งรายการวัสดุต่อหนึ่งบล็อก ไม่ตัดกลางรายการ
    if ((S.surveys || []).length) {
      need(ROW_H * 5 + ROW_H * 1.5 * (((S.surveys[0].quotes) || []).length || 1));
      sec(`${++secNo}. ราคาสืบ (${S.surveys.length} รายการ)`);
      S.surveys.forEach((v, i) => {
        const qs = (v.quotes || []).map(q => { const a = shorten(q.shop, `${q.shop || '-'} — ${v.name}`), c = shorten(q.contact, `${q.shop || '-'} — ${v.name}`); return Object.assign({}, q, { shopT: a.text, shopL: a.link, contT: c.text, contL: c.link || a.link }); });
        const hh = qs.map(q => rowH([q.shopT, 29], [q.contT, 19]));
        need(ROW_H * 3 + hh.reduce((a, b) => a + b, 0) + ROW_H);
        cell(1, 5, `${i + 1}. ${v.name}  [${v.unit || ''}]  ·  ${v.n} เจ้า${v.n < (v.need || 3) ? ' (ไม่ครบ ' + (v.need || 3) + ' เจ้า)' : ''}`, { bold: true, border: true, fill: GREY2 });
        cell(6, 8, v.price === null || v.price === undefined ? 'ยังไม่มีราคาที่ใช้' : `ราคาที่ใช้ ${money(v.price)} บาท/${v.unit || 'หน่วย'}`, { bold: true, al: 'right', border: true, fill: GREY2 }); r++;
        hdr([[1, 1, 'ลำดับ'], [2, 2, 'ร้าน / ช่องทาง'], [3, 3, 'VAT'], [4, 4, 'ราคาเสนอ'], [5, 5, 'ตัวคูณ'], [6, 6, 'บาท/' + (v.unit || 'หน่วย')], [7, 7, 'ช่องทาง / ผู้ติดต่อ'], [8, 8, 'วันที่']]);
        qs.forEach((q, k) => {
          const o = { border: true, h: hh[k], fill: q.best ? PICK : undefined };
          cell(1, 1, q.best ? '✓' : k + 1, Object.assign({ al: 'center', bold: !!q.best }, o));
          cell(2, 2, q.shopT || '', Object.assign({ wrap: true, link: q.shopL }, o));
          cell(3, 3, q.vat ? 'รวม' : 'ไม่รวม', Object.assign({ al: 'center' }, o));
          cell(4, 4, num(q.price), Object.assign({ al: 'right', fmt: NUM }, o));
          cell(5, 5, num(q.factor) || 1, Object.assign({ al: 'right', fmt: NUM }, o));
          cell(6, 6, num(q.up), Object.assign({ al: 'right', fmt: NUM }, o));
          cell(7, 7, q.contT || '', Object.assign({ wrap: true, link: q.contL && q.contL !== q.shopL ? q.contL : (q.shopL ? null : q.contL) }, o));
          cell(8, 8, q.date || '', Object.assign({ al: 'center' }, o)); r++;
        });
        r++;
      });
      if (refs.length) {
        const chunk = u => (u.match(/.{1,46}/g) || [u]).join('\n');   // ตัดบรรทัดเอง (ลิงก์ไม่มีช่องว่างให้ขึ้นบรรทัดใหม่)
        const rh = refs.map(x => ROW_H * Math.max(chunk(x.url).split('\n').length, wrapH(x.used.join(' ; '), 36)));
        need(ROW_H * 3 + rh[0]);
        sec('เอกสารอ้างอิง — ลิงก์เต็มของช่องทางติดต่อในตารางราคาสืบ (' + refs.length + ' ลิงก์)');
        hdr([[1, 1, 'อ้างอิง'], [2, 6, 'ลิงก์'], [7, 8, 'ใช้กับ']]);
        refs.forEach((x, i) => {
          if (i > 0) need(rh[i]);
          cell(1, 1, `[${i + 1}]`, { al: 'center', border: true, h: rh[i], link: x.url });
          cell(2, 6, chunk(x.url), { border: true, wrap: true, h: rh[i] });
          cell(7, 8, x.used.join(' ; '), { border: true, wrap: true, h: rh[i] }); r++;
        });
        r++;
      }
      cell(1, 8, 'หมายเหตุ: ✓ (แถวพื้นเทา) = ราคาของเจ้าที่ใช้เป็นราคาอ้างอิงของรายการนั้น · ราคาสืบเก็บเป็นสำเนาตัวหนังสือ ไม่แนบภาพ (ภาพอยู่ในคลังราคาสืบกลาง)', { size: 12 }); r++;
    }
    // วัสดุ (Backup โครงการ)
    if ((S.materials || []).length) {
      need(ROW_H * 7);
      sec(`${++secNo}. ราคาวัสดุที่เก็บไว้ในโครงการ (Backup) (${S.materials.length} รายการ)`);
      hdr([[1, 1, 'ลำดับ'], [2, 2, 'รายการวัสดุ'], [3, 3, 'หน่วย'], [4, 6, 'ราคา/หน่วย (บาท)'], [7, 7, 'หมวด'], [8, 8, 'จังหวัด']]);
      S.materials.forEach((m, i) => {
        const h = rowH([m.name, 32], [m.cat, 19]);
        if (i === 0) need(h * 2);
        cell(1, 1, i + 1, { al: 'center', border: true, h });
        cell(2, 2, m.name, { border: true, wrap: true, h });
        cell(3, 3, m.unit || '', { al: 'center', border: true, h });
        cell(4, 6, num(m.price), { al: 'right', border: true, fmt: NUM, h });
        cell(7, 7, m.cat || '', { border: true, wrap: true, h });
        cell(8, 8, m.province || '', { al: 'center', border: true, h }); r++;
      });
      r++;
    }
    // ค่าแรง
    if ((S.wages || []).length) {
      need(ROW_H * 7);
      sec(`${++secNo}. ค่าแรงที่เก็บไว้ในโครงการ (Backup) (${S.wages.length} รายการ)`);
      hdr([[1, 1, 'ลำดับ'], [2, 2, 'รายการงาน'], [3, 3, 'หน่วย'], [4, 6, 'ค่าแรง/หน่วย (บาท)'], [7, 8, 'หมวด / ที่มา']]);
      S.wages.forEach((m, i) => {
        const h = rowH([m.name, 32], [m.sheet, 30]);
        if (i === 0) need(h * 2);
        cell(1, 1, i + 1, { al: 'center', border: true, h });
        cell(2, 2, m.name, { border: true, wrap: true, h });
        cell(3, 3, m.unit || '', { al: 'center', border: true, h });
        const pv = num(m.price);
        cell(4, 6, pv === null || pv === 0 ? (m.raw || null) : pv, { al: 'right', border: true, fmt: NUM, h });
        cell(7, 8, m.sheet || '', { border: true, wrap: true, h }); r++;
      });
      r++;
    }
    ws.pageSetup.printArea = `A1:H${Math.max(r, 5)}`;
    return ws;
  }

  function unmergeFrom(ws, r0) {
    Object.keys(ws._merges || {}).forEach(k => { const m = ws._merges[k]; if (m && m.model && m.model.top >= r0) ws.unMergeCells(m.range || k); });
  }
  /** ล้างแถว r0 ลงไปทั้งหมด (ค่า รูปแบบ ความสูง เส้นแบ่งหน้า) — ไม่ใช้ spliceRows เพราะ ExcelJS ลบไม่หมด */
  function clearFrom(ws, r0) {
    unmergeFrom(ws, r0);
    const last = Math.max(ws.rowCount || 0, ws.actualRowCount || 0, (ws.lastRow && ws.lastRow.number) || 0);
    for (let r = r0; r <= last; r++) {
      const row = ws.getRow(r);
      row.eachCell({ includeEmpty: true }, c => { c.value = null; c.style = {}; });
      row.height = undefined; row.hidden = false;
    }
    if (ws.rowBreaks) ws.rowBreaks = ws.rowBreaks.filter(b => b.id < r0);
  }
  function fit(ws) { ws.pageSetup.fitToPage = true; ws.pageSetup.fitToWidth = 1; ws.pageSetup.fitToHeight = 0; }
  /** ความสูงแถวตามความยาวข้อความ (คอลัมน์รวม ~ n ตัวอักษร/บรรทัด) */
  /** จำนวนบรรทัดที่ข้อความกินในช่องกว้าง ~cap หน่วยตัวเลข: นับความกว้างที่มองเห็น (สระบน/วรรณยุกต์ไม่กินที่) */
  const vwid = s => { let u = 0; for (const ch of String(s || '')) { if (/[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/.test(ch)) continue; u += ch === ' ' ? 0.45 : /[\u0E00-\u0E7F]/.test(ch) ? 0.9 : /[A-Z0-9]/.test(ch) ? 1.0 : 0.9; } return u; };
  const lines = (s, cap) => Math.max(1, Math.ceil(vwid(s) / cap));
  const ROW_H = 19.5;   // 0.69 ซม. — ความสูงแถวมาตรฐานของตารางรายการ
  const thDate = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : (iso || null); };
  const thDateText = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); if (!m) return ''; const M = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม']; return `${+m[3]} ${M[+m[2] - 1]} ${+m[1] + 543}`; };
  const sheetName = n => `'${n}'`;

  /**
   * data: {mode 'estimate'|'central', project:{name, location, agency, drawing_no, calc_date},
   *        people:[{role,name,pos}], sections:[{code, name, groups:[{code, name, rows:[{name, qty, unit, mat, lab}]}]}],
   *        factor:{F, advance, retention, loanShare, table:[[tier, noVat, F]…]}, pr2:[{name,qty,unit,price,install}], pr3:[{name,qty,unit,amount,note}]}
   */
  async function build(ExcelJS, templateBuf, data) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(templateBuf);
    const est = data.mode !== 'central', P = data.project || {}, RG = est ? 'ประมาณราคา' : 'ราคากลาง';
    const dateLabel = est ? 'ประมาณราคาเมื่อวันที่' : 'คำนวณราคากลางเมื่อวันที่';
    const people = (data.people && data.people.length ? data.people : [{ role: 'ผู้ประมาณราคา', name: '' }]);
    const sigName = x => `(   ${x.name || '......................................'}   )`;
    const sigRole = x => est ? 'ผู้ประมาณราคา' : x.role;
    const out = { rows: {} };

    // ---------------------------------------------------------------- ปร.1
    const s1 = wb.getWorksheet('ปร.1');
    s1.getCell('D3').value = P.name || ''; s1.getCell('D4').value = P.location || ''; s1.getCell('D5').value = P.agency || '';
    s1.getCell('D6').value = thDate(P.calc_date); s1.getCell('A6').value = dateLabel;
    s1.getCell('L3').value = P.drawing_no || '';
    const pSum = proto(s1, 11), pSumTot = proto(s1, 14), pNote = proto(s1, 16), pBlank = proto(s1, 15), pSig1 = proto(s1, 19), pSig2 = proto(s1, 20);
    const pHdr = [25, 26, 27, 28, 29].map(r => proto(s1, r)), hdrVals = [25, 26, 27, 28, 29].map(r => { const o = {}; COLS.forEach(c => { o[c] = s1.getRow(r).getCell(c).value; }); return o; });
    const pGap = proto(s1, 30), pSec = proto(s1, 31), pGrp = proto(s1, 32), pItem = proto(s1, 33), pSecTot = proto(s1, 50), pSecGap = proto(s1, 51), pGrand = proto(s1, 74);
    clearFrom(s1, 10);
    const secs = (data.sections || []).filter(s => s.groups.some(g => g.rows.length));
    // ผังแถว: สรุปหน้าแรก → หัวตารางรายละเอียด → หมวด/กลุ่ม/รายการ
    let r = 11; const sumRows = secs.map(() => r++); const sumTot = r++; r++; const noteRow = r++; r++;
    const sigRow = r; r += 2 + (est ? 0 : (Math.ceil(people.length / 3) - 1) * 3);
    r += 2; const hdr0 = r; r += 5; const gap0 = r++;
    const layout = secs.map(s => {
      const o = { sec: r++, groups: [] };
      s.groups.forEach(g => { if (!g.rows.length) return; const go = { row: g.noHeader ? null : r++, items: [] }; g.rows.forEach(() => go.items.push(r++)); o.groups.push(go); });
      o.tot = r++; r++; return o;
    });
    const grand = r;
    // สรุป
    secs.forEach((s, i) => put(s1, sumRows[i], pSum, { A: f(`A${layout[i].sec}`), B: f(`B${layout[i].sec}`), I: 'รวม', N: f(`N${layout[i].tot}`) }));
    put(s1, sumTot, pSumTot, { B: 'รวมค่าวัสดุและค่าแรงงานเป็นเงินประมาณ', N: f(secs.length ? `SUM(N${sumRows[0]}:N${sumRows[sumRows.length - 1]})` : '0') });
    put(s1, noteRow, pNote, { I: 'หมายเหตุ : แสดงรายการปริมาณ และราคารวม', J: f(`N${sumTot}`), K: 'บาท ต่อ 1 หน่วย' });
    // ลงนาม
    const who = est ? people.slice(0, 1) : people;
    sigs(s1, sigRow, est ? [['M', 'N']] : [['C', 'D'], ['H', 'J'], ['M', 'N']], who, pSig1, pSig2, COLS, sigName, sigRole);
    // หัวตารางรายละเอียด
    pHdr.forEach((p, k) => put(s1, hdr0 + k, p, hdrVals[k]));
    [`A${hdr0}:O${hdr0}`, `A${hdr0 + 1}:O${hdr0 + 1}`, `A${hdr0 + 3}:A${hdr0 + 4}`, `B${hdr0 + 3}:G${hdr0 + 4}`, `H${hdr0 + 3}:H${hdr0 + 4}`, `I${hdr0 + 3}:I${hdr0 + 4}`,
      `J${hdr0 + 3}:K${hdr0 + 3}`, `L${hdr0 + 3}:M${hdr0 + 3}`, `N${hdr0 + 3}:N${hdr0 + 4}`, `O${hdr0 + 3}:O${hdr0 + 4}`].forEach(m => s1.mergeCells(m));
    put(s1, gap0, pGap); s1.getRow(gap0).height = ROW_H;
    s1.getRow(hdr0 - 1).addPageBreak();
    secs.forEach((s, i) => {
      const L = layout[i];
      put(s1, L.sec, pSec, { A: s.code || String(i + 1), B: s.name }).height = ROW_H;
      s.groups.filter(g => g.rows.length).forEach((g, j) => {
        const go = L.groups[j];
        if (go.row) put(s1, go.row, pGrp, { A: g.code || `${i + 1}.${j + 1}`, B: g.name }).height = ROW_H;
        g.rows.forEach((it, k) => {
          const rr = go.items[k];
          const row = put(s1, rr, pItem, { B: '-', C: it.name, H: it.qty, I: it.unit, J: it.mat === null || it.mat === undefined ? null : it.mat,
            K: f(`ROUND(H${rr}*J${rr},2)`), L: it.lab === null || it.lab === undefined ? null : it.lab, M: f(`ROUND(H${rr}*L${rr},2)`), N: f(`K${rr}+M${rr}`) });
          s1.mergeCells(`C${rr}:G${rr}`);
          const n = lines(it.name, 43);
          row.height = ROW_H * n;
          const c = row.getCell('C'); c.alignment = Object.assign({}, c.alignment, { wrapText: true, vertical: n > 1 ? 'top' : 'center' });
          if (n > 1) COLS.forEach(k => { if (k !== 'C') { const cc = row.getCell(k); cc.alignment = Object.assign({}, cc.alignment, { vertical: 'top' }); } });
        });
      });
      const first = L.groups.length ? (L.groups[0].row || L.groups[0].items[0]) : L.sec + 1, last = L.tot - 1;
      const S = c => f(`SUM(${c}${first}:${c}${last})`);
      put(s1, L.tot, pSecTot, { B: f(`"รวมค่า"&B${L.sec}`), H: '-', I: '-', J: S('J'), K: S('K'), L: S('L'), M: S('M'), N: S('N') }).height = ROW_H;
      put(s1, L.tot + 1, pSecGap).height = ROW_H;
    });
    put(s1, grand, pGrand, { B: 'รวมค่าวัสดุ และแรงงาน', N: f(layout.length ? layout.map(L => `N${L.tot}`).join('+') : '0') });
    // จำนวนหน้า (ประมาณจากความสูงแถว — แก้ได้)
    let h = 0, pages = 1; const pageH = 575, titleH = [0, 1, 2, 3, 4].reduce((a, k) => a + (s1.getRow(hdr0 + k).height || ROW_H), 0);
    for (let k = hdr0; k <= grand; k++) { const hh = s1.getRow(k).height || ROW_H; if (h + hh > pageH) { pages++; h = titleH; } h += hh; }
    s1.getCell('O6').value = pages + 1;
    ['J', 'K', 'L', 'M'].forEach(c => { s1.getColumn(c).width = 14.5; }); s1.getColumn('N').width = 15;
    s1.pageSetup.printArea = `A1:O${grand}`;
    s1.pageSetup.fitToPage = false; s1.pageSetup.scale = 83; s1.pageSetup.paperSize = 9; s1.pageSetup.orientation = 'landscape';   // A4 แนวนอน กว้างพอดี A–O (กำหนดสเกลตรง ไม่พึ่ง fit-to-page)
    s1.pageSetup.printTitlesRow = `${hdr0}:${hdr0 + 4}`;
    out.rows.pr1Sum = sumTot; out.rows.pr1Grand = grand; out.rows.secTot = layout.map(L => L.tot);

    // ---------------------------------------------------------------- Factor F
    const sf = wb.getWorksheet('Factor F');
    const F = data.factor || {}, adv = +F.advance || 0, ret = +F.retention || 0;
    [['E6', adv / 100], ['E7', ret / 100], ['E42', adv / 100], ['E43', ret / 100]].forEach(([c, v]) => { sf.getCell(c).value = v; });
    (F.table || []).forEach((t, k) => {
      const rr = 12 + k; if (rr > 35) return;
      sf.getCell(`E${rr}`).value = parseFloat(String(t[0]).replace(/[^0-9.]/g, '')); sf.getCell(`F${rr}`).value = t[1]; sf.getCell(`G${rr}`).value = t[2];
    });
    sf.getCell('G37').value = f(`${sheetName('ปร.1')}!N${sumTot}`);
    const loan = +F.loanShare || 0;
    if (loan > 0) {
      sf.getCell('H49').value = F.F;
      sf.getCell('K2').value = `เงินกู้ไม่เสีย VAT ${+(loan * 100).toFixed(2)}% — Factor F ถ่วงตามสัดส่วน (คำนวณจากเว็บ)`;
    } else {
      const I = 'INDEX(G12:G35,MATCH(G37/1000000,E12:E33,1))', I2 = 'INDEX(G12:G35,MATCH(G37/1000000,E12:E33,1)+1)', E1 = 'INDEX(E12:E35,MATCH(G37/1000000,E12:E33,1))', E2 = 'INDEX(E12:E35,MATCH(G37/1000000,E12:E33,1)+1)';
      sf.getCell('H49').value = f(`IF(OR(G37="",G37=0),"-",ROUNDDOWN(IF(G37<=E12*1000000,G12,IF(G37>E34*1000000,G35,${I}-((${I}-${I2})*(G37/1000000-${E1})/(${E2}-${E1})))),4))`);
    }

    // ---------------------------------------------------------------- ปร.1 (ก)
    const sa = wb.getWorksheet('ปร.1 (ก)');
    sa.getCell('A6').value = dateLabel; sa.getCell('A1').value = est ? 'แบบสรุปประมาณราคาค่าก่อสร้าง' : 'แบบสรุปราคากลางค่าก่อสร้าง';
    sa.getCell('K3').value = P.drawing_no || '';
    const aRow = proto(sa, 10, COLS.slice(0, 13)), n1 = Math.max(secs.length, 1);
    try { sa.unMergeCells('H10:I10'); } catch (e) { /* ไม่มี */ }
    if (n1 > 1) sa.spliceRows(11, 0, ...Array.from({ length: n1 - 1 }, () => []));
    secs.forEach((s, i) => {
      const rr = 10 + i;
      put(sa, rr, aRow, { A: i + 1, B: (s.code ? s.code + ' ' : '') + s.name, H: f(`${sheetName('ปร.1')}!N${layout[i].tot}`), J: f(`${sheetName('Factor F')}!H49`), K: f(`ROUND(H${rr}*J${rr},2)`) }, COLS.slice(0, 13));
      try { sa.mergeCells(`H${rr}:I${rr}`); } catch (e) { /* รวมอยู่แล้ว */ }
    });
    const d = n1 - 1, tot1 = 17 + d;
    sa.getCell(`C${13 + d}`).value = `เงินล่วงหน้าจ่าย         ${adv} %`; sa.getCell(`C${14 + d}`).value = `เงินประกันผลงานหัก   ${ret} %`;
    sa.getCell(`C${15 + d}`).value = 'ดอกเบี้ยเงินกู้           6 %'; sa.getCell(`C${16 + d}`).value = 'ภาษีมูลค่าเพิ่ม          7 %' + (loan ? ` · เงินกู้ไม่เสีย VAT ${+(loan * 100).toFixed(2)}%` : '');
    sa.getCell(`K${tot1}`).value = f(`SUM(K10:K${9 + n1})`); sa.getCell(`H${18 + d}`).value = f(`K${tot1}`);
    sa.getCell('J4').value = f(`"แบบ ปร.1 ที่แนบ จำนวน   "&${sheetName('ปร.1')}!O6&"   หน้า"`);
    const sigA = 21 + d, pA1 = proto(sa, 21, COLS.slice(0, 13)), pA2 = proto(sa, 22, COLS.slice(0, 13));
    sigs(sa, sigA, est ? [['K', 'K']] : [['C', 'D'], ['H', 'I'], ['K', 'K']], who, pA1, pA2, COLS.slice(0, 13), sigName, sigRole);
    out.rows.pr1aTot = tot1;

    // ---------------------------------------------------------------- ปร.2 / ปร.2(ก)
    const pr2 = (data.pr2 || []).filter(x => x.name || +x.qty);
    let pr2Tot = null;
    if (pr2.length) {
      const s2 = wb.getWorksheet('ปร.2'), C14 = COLS.slice(0, 14);
      s2.getCell('A6').value = dateLabel; s2.getCell('L3').value = P.drawing_no || '';
      const p10 = proto(s2, 10, C14), p11 = proto(s2, 11, C14), p12 = proto(s2, 12, C14), p13 = proto(s2, 13, C14);
      clearFrom(s2, 10);
      put(s2, 10, p10, { A: 1, B: 'ครุภัณฑ์จัดซื้อ' }, C14);
      const i0 = 11; pr2.forEach((x, k) => { const rr = i0 + k; put(s2, rr, p11, { A: `1.${k + 1}`, B: x.name, H: +x.qty || 0, I: x.unit || '', J: +x.price || 0, K: f(`ROUND(H${rr}*J${rr},2)`), L: f(`K${rr}`), M: f(`ROUND(H${rr}*${+x.install || 0},2)`) }, C14); s2.mergeCells(`B${rr}:G${rr}`); });
      const iL = i0 + pr2.length - 1, t1 = iL + 1, t2 = iL + 2;
      put(s2, t1, p12, { B: 'รวมค่างานครุภัณฑ์ติดตั้ง', L: f(`SUM(L${i0}:L${iL})`), M: f(`SUM(M${i0}:M${iL})`) }, C14);
      put(s2, t2, p13, { B: 'รวมค่าครุภัณฑ์และค่าติดตั้ง', L: f(`L${t1}`), M: f(`M${t1}`) }, C14);
      s2.pageSetup.printArea = `A1:N${t2 + 2}`;
      const sb = wb.getWorksheet('ปร.2(ก)');
      sb.getCell('A6').value = dateLabel;
      const rg = c => `${sheetName('ปร.2')}!${c}${i0}:${c}${iL}`;
      sb.getCell('B10').value = 'ครุภัณฑ์จัดซื้อ';
      sb.getCell('F10').value = f(`${sheetName('ปร.2')}!L${t2}`);
      sb.getCell('G10').value = f(`SUMPRODUCT(ROUND(${rg('K')}*0.07,2))`);   // VAT ปัดรายแถวเหมือนเว็บ
      sb.getCell('H10').value = f(`${sheetName('ปร.2')}!M${t2}`);
      sb.getCell('I10').value = f(`SUMPRODUCT(ROUND(${rg('M')}*0.07,2))`);
      sb.getCell('J10').value = f('F10+G10+H10+I10');
      sb.getCell('I4').value = '';
      const C11b = COLS.slice(0, 11), q15 = proto(sb, 15, C11b), q16 = proto(sb, 16, C11b);
      sigs(sb, 15, est ? [['I', 'I']] : [['C', 'D'], ['F', 'G'], ['I', 'J']], who, q15, q16, C11b, sigName, sigRole);
      pr2Tot = `${sheetName('ปร.2(ก)')}!J11`;
    } else { wb.removeWorksheet(wb.getWorksheet('ปร.2').id); wb.removeWorksheet(wb.getWorksheet('ปร.2(ก)').id); }

    // ---------------------------------------------------------------- ปร.3
    const pr3 = (data.pr3 || []).filter(x => x.name || +x.amount);
    let pr3Tot = null;
    if (pr3.length) {
      const s3 = wb.getWorksheet('ปร.3'), C11 = COLS.slice(0, 11);
      s3.getCell('A6').value = dateLabel; s3.getCell('K3').value = P.drawing_no || '';
      const p11 = proto(s3, 11, C11), p14 = proto(s3, 14, C11), p26 = proto(s3, 26, C11), p27 = proto(s3, 27, C11), p41 = proto(s3, 41, C11), p42 = proto(s3, 42, C11);
      clearFrom(s3, 10);
      pr3.forEach((x, k) => { const rr = 11 + k; put(s3, rr, p11, { A: k + 1, B: x.name, H: +x.qty || 0, I: x.unit || '', J: +x.amount || 0, K: x.note ? String(x.note).slice(0, 60) : null }, C11); s3.mergeCells(`B${rr}:G${rr}`); });
      const tr = 11 + pr3.length + 1;
      put(s3, tr, p14, { B: 'รวมค่าใช้จ่ายพิเศษตามข้อกำหนด ทุกรายการ', J: f(`SUM(J11:J${tr - 1})`) }, C11); s3.mergeCells(`B${tr}:I${tr}`);
      let rr = tr + 3; put(s3, rr++, p26, { B: '1. เหตุผลและความจำเป็นที่ต้องมีค่าใช้จ่ายพิเศษตามข้อกำหนดฯ' }, C11);
      pr3.forEach((x, k) => { const row = put(s3, rr++, p27, { A: `${k + 1}. ${x.name}${x.note ? ' — ' + x.note : ''}` }, C11); s3.mergeCells(`A${row.number}:K${row.number}`); row.getCell('A').alignment = { wrapText: true, vertical: 'top' }; row.height = 21.75 * lines(row.getCell('A').value, 110); });
      rr += 2; const rEnd = sigs(s3, rr, est ? [['J', 'K']] : [['C', 'D'], ['H', 'I'], ['J', 'K']], who, p41, p42, C11, sigName, sigRole);
      s3.pageSetup.printArea = `A1:K${rEnd - 2}`;
      pr3Tot = `${sheetName('ปร.3')}!J${tr}`;
    } else wb.removeWorksheet(wb.getWorksheet('ปร.3').id);

    // ---------------------------------------------------------------- ปร.4
    const s4 = wb.getWorksheet('ปร.4'), C9 = COLS.slice(0, 9);
    s4.getCell('A1').value = est ? 'แบบสรุปประมาณราคาค่าก่อสร้าง' : 'แบบสรุปราคากลางงานก่อสร้าง'; s4.getCell('A5').value = dateLabel; s4.getCell('I2').value = P.drawing_no || '';
    const p9 = proto(s4, 9, C9), p10 = proto(s4, 10, C9), p11 = proto(s4, 11, C9), p12 = proto(s4, 12, C9), p13 = proto(s4, 13, C9), p17 = proto(s4, 17, C9), p18 = proto(s4, 18, C9);
    clearFrom(s4, 9);
    const items4 = [['ค่างานต้นทุน (ค่าก่อสร้างตาม ปร.1 (ก))', `${sheetName('ปร.1 (ก)')}!K${tot1}`], ['ค่าครุภัณฑ์จัดซื้อ', pr2Tot], ['ค่าใช้จ่ายพิเศษตามข้อกำหนด', pr3Tot]];
    items4.forEach(([nm, ref], k) => { const rr = 9 + k; put(s4, rr, p9, { A: k + 1, B: nm, H: ref ? f(ref) : 0 }, C9); s4.mergeCells(`B${rr}:G${rr}`); });
    const s0 = 9 + items4.length; put(s4, s0, p10, {}, C9);
    const sumR = s0 + 1;
    put(s4, sumR, p11, { A: 'สรุป', C: 'รวมค่าก่อสร้างทั้งโครงการ', H: f(`SUM(H9:H${s0 - 1})`) }, C9);
    put(s4, sumR + 1, p12, { E: est ? 'คิดเพียง' : RG, H: f(est ? `ROUNDDOWN(H${sumR},-3)` : `H${sumR}`) }, C9);
    put(s4, sumR + 2, p13, { C: f(`"${est ? 'ประมาณราคาค่าก่อสร้าง' : 'ราคากลาง'} (.......... "&BAHTTEXT(H${sumR + 1})&" ….......)"`, data.pr4Text ? `${est ? 'ประมาณราคาค่าก่อสร้าง' : 'ราคากลาง'} (.......... ${data.pr4Text} ….......)` : undefined) }, C9);
    s4.mergeCells(`A${sumR}:A${sumR + 2}`);
    let sg = sumR + 5;
    sigs(s4, sg, est ? [['H', 'H']] : [['C', 'D'], ['H', 'H']], who, p17, p18, C9, sigName, sigRole);
    out.rows.pr4Sum = sumR; out.rows.pr4Final = sumR + 1;

    // ลำดับชีตให้ปร.4 อยู่ท้าย + ตั้งชีตแรกให้เปิด
    wb.worksheets.forEach(ws => { if (ws.name !== 'Factor F' && ws.name !== 'ปร.1') fit(ws); if (/\(ก\)|ปร\.4/.test(ws.name)) ws.pageSetup.fitToHeight = 1; });
    if (data.sources) sourcesSheet(wb, P, data.sources, thDateText(P.calc_date));
    wb.views = [{ activeTab: 0 }];
    out.wb = wb;
    return out;
  }
  return { build };
});
