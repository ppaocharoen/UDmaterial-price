/* ไฟล์ใช้ร่วมสองเว็บ (เหมือนกันทุกไบต์): UD Cost Hub lib/survey-v1.js = UD-Total-Station lib/survey.js — แก้ที่ไหนให้คัดลอกทั้งไฟล์ไปอีกที่ แล้วรัน UD-Total-Station tools/check_shared.js · ถ้าแก้ผลคำนวณให้ทำไฟล์ -v2 ใหม่ (รวมเมื่อ 18 พ.ย. 2569) */
/* UD Survey — ราคาสืบ (ตกลงกับ Earth 18 ต.ค. 2569)
 * วัสดุ 1 รายการ สืบหลายราย (ปกติ 3) เลือกรายที่ต่ำสุด; ราคาที่รวม VAT ให้หัก VAT (÷ 1.07); แปลงหน่วยร้านเป็นหน่วยใน ปร. ด้วยตัวคูณ
 * หลักฐาน: ลิงก์ / เบอร์โทร / ไลน์ / ใบเสนอราคา + ภาพแคปหน้าจอ (ย่อเป็น JPEG แล้วเก็บใน .boq.json)
 *
 * item  = { id, name, unit, target: 'row:<key>' | 'sub:<code>' | 'manual', quotes: [quote], reason, updated }
 * quote = { id, channel: 'web'|'phone'|'line'|'quote'|'store', shop, contact, date, price, qunit, factor, vat, note, imgs: [imgId] }
 *   factor = จำนวนหน่วย ปร. ต่อ 1 หน่วยที่ร้านขาย (เช่น 1 กล่อง = 1.44 ตร.ม. → factor 1.44)
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.Survey = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const VAT = 0.07, MIN_Q = 3;
  const r2 = x => Math.round((x + Number.EPSILON) * 100) / 100;
  const CHANNEL = { web: 'เว็บไซต์', phone: 'โทรสืบ', line: 'ไลน์', quote: 'ใบเสนอราคา', store: 'หน้าร้าน' };
  const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  /** ราคาต่อหน่วย ปร. ไม่รวม VAT ของรายหนึ่ง (null ถ้ายังไม่ครบ) */
  function unitPrice(q) {
    const p = +q.price, f = +(q.factor || 1);
    if (!(p > 0) || !(f > 0)) return null;
    return r2((q.vat ? p / (1 + VAT) : p) / f);
  }
  /** สรุปรายการ: ราคาที่ใช้ (ต่ำสุด), จำนวนราย, รายที่เลือก, สถานะ */
  function summary(item) {
    const list = (item.quotes || []).map(q => ({ q, up: unitPrice(q) })).filter(x => x.up !== null);
    if (!list.length) return { price: null, n: 0, best: null, status: 'none', list };
    const best = list.reduce((a, b) => (b.up < a.up ? b : a));
    return { price: best.up, n: list.length, best: best.q, status: list.length >= MIN_Q ? 'ok' : 'few', list };
  }
  function srcText(item) {
    const s = summary(item); if (s.price === null) return '';
    return `ราคาสืบ ต่ำสุดจาก ${s.n} ราย: ${s.best.shop || CHANNEL[s.best.channel] || ''}${s.best.date ? ' (' + s.best.date + ')' : ''}`;
  }
  const norm = t => String(t || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const libKey = (name, unit) => norm(name) + '|' + norm(unit);
  const ageDays = d => (d ? Math.floor((Date.now() - new Date(d).getTime()) / 864e5) : null);

  // ---------------------------------------------------------------- ย่อภาพ (เบราว์เซอร์)
  function compress(file, maxSide = 1600, q = 0.72) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => {
        const img = new Image();
        img.onload = () => {
          const k = Math.min(1, maxSide / Math.max(img.width, img.height)), c = document.createElement('canvas');
          c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
          const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
          res(c.toDataURL('image/jpeg', q));
        };
        img.onerror = rej; img.src = fr.result;
      };
      fr.onerror = rej; fr.readAsDataURL(file);
    });
  }

  // ---------------------------------------------------------------- IndexedDB: ภาพ (สำรองอัตโนมัติ) และคลังราคาสืบ (ใช้ข้ามโครงการ)
  let dbp = null;
  function idb() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      if (typeof indexedDB === 'undefined') return rej(new Error('ไม่มี IndexedDB'));
      const r = indexedDB.open('ud-survey', 1);
      r.onupgradeneeded = () => { r.result.createObjectStore('img'); r.result.createObjectStore('lib'); };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  async function op(store, mode, fn) {
    const d = await idb();
    return new Promise((res, rej) => { const t = d.transaction(store, mode), s = t.objectStore(store), r = fn(s); t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error); });
  }
  // ---------------------------------------------------------------- คลังกลาง (Google Sheet ผ่าน Apps Script — tools/survey_lib.gs)
  // ตั้งค่าเก็บในเบราว์เซอร์: {url, team} · ไม่ตั้ง = ใช้คลังในเครื่อง (IndexedDB)
  const CFG_KEY = 'udts:lib', TEAM_SS = 'udts:libteam';
  // ตั้งค่า {url, team, remember}: url เก็บถาวร · รหัสทีมเก็บถาวรเฉพาะเมื่อเลือก "จำ" ไม่งั้นอยู่แค่แท็บนี้ (sessionStorage)
  function cfg() {
    let c = {}; try { c = JSON.parse(localStorage.getItem(CFG_KEY) || '{}'); } catch (e) { /* */ }
    if (!c.url && root_lib()) c.url = root_lib();
    if (!c.team) { try { c.team = sessionStorage.getItem(TEAM_SS) || ''; } catch (e) { /* */ } }
    return c;
  }
  // URL คลังกลางมาตรฐานของทีม (ใช้ร่วมกับ UD Total Station) — ผู้ใช้ไม่ต้องตั้งค่าเอง; ตั้งค่าเองในเบราว์เซอร์ได้ถ้าต้องการใช้คลังอื่น
  const DEFAULT_LIB_URL = 'https://script.google.com/macros/s/AKfycbxkt8_WfbwxBg9NjhhtTKe5Zo1Ui8G1zYjuaPGQWqcch4NWnBcc9iueufJpO_pG_5M2/exec';
  function root_lib() { try { return (typeof UD_VERSION !== 'undefined' && UD_VERSION.LIB_URL) || DEFAULT_LIB_URL; } catch (e) { return DEFAULT_LIB_URL; } }
  /** ที่เก็บภาพ: ค่าภาพในคลัง = "รหัสไฟล์" (ที่เก็บ main — แบบเดิม) หรือ "ชื่อที่เก็บ:รหัสไฟล์" (ที่เก็บอื่น เช่น Drive อีกบัญชี)
   *  แต่ละที่เก็บมีสคริปต์ของตัวเอง: URL ตั้งใน cfg().stores = {ชื่อที่เก็บ: url} · main ไม่ตั้ง = ใช้ URL คลังกลางปัจจุบัน
   *  ย้ายภาพในอนาคต = เพิ่มที่เก็บใหม่ แล้วค่อยคัดลอกภาพเก่าและเปลี่ยนค่าในคลัง ภาพเก่าไม่หายระหว่างย้าย */
  function imgRef(v) { const m = String(v).match(/^([A-Za-z0-9_-]{1,20}):(.+)$/); return m ? { store: m[1], file: m[2] } : { store: 'main', file: String(v) }; }
  function storeUrl(store) { const c = cfg(); return (c.stores && c.stores[store]) || (store === 'main' ? c.url : ''); }
  function setCfg(c) {
    const keep = Object.assign({}, c); if (!c.remember) delete keep.team;
    try { localStorage.setItem(CFG_KEY, JSON.stringify(keep)); } catch (e) { /* */ }
    try { if (c.remember || !c.team) sessionStorage.removeItem(TEAM_SS); else sessionStorage.setItem(TEAM_SS, c.team); } catch (e) { /* */ }
    cache = null;
  }
  const remote = () => !!cfg().url;
  /** เรียกคลังกลาง: POST text/plain (ไม่มี preflight) รหัสทีมหรือ token ล็อกอินอยู่ใน body ไม่อยู่ใน URL
   *  ลำดับ: รหัสทีม (แบบเดิม) → token ล็อกอิน Google (window.UDAuth) → ไม่มีทั้งสอง = ใช้คลังในเครื่องเท่านั้น */
  async function authToken() { try { return (typeof window !== 'undefined' && window.UDAuth) ? await window.UDAuth.token() : ''; } catch (e) { return ''; } }
  async function rpost(body, c) {
    c = c || cfg();
    const id = c.team ? { team: c.team } : { token: await authToken() };
    if (!id.team && !id.token && body.action !== 'list' && body.action !== 'clist') throw new Error('ต้องใส่รหัสทีมหรือเข้าสู่ระบบก่อน');   // ไม่ล็อกอิน: อ่านรายการได้แบบสาธารณะ (ไม่มีชื่อร้าน/ติดต่อ/หมายเหตุ/ภาพ)
    const r = await fetch(c.url, { method: 'POST', body: JSON.stringify(Object.assign(id, body)), headers: { 'Content-Type': 'text/plain;charset=utf-8' }, redirect: 'follow' });
    const d = await r.json(); if (!d.ok && d.auth) throw new Error(d.error); return d;
  }
  // สิทธิ์เขียนคลังกลาง: รหัสทีม หรือบัญชีที่ผู้ดูแลอนุมัติแล้ว (ตั้งจากหน้าเว็บหลังตรวจ whoami)
  let access = { writable: false };
  const setAccess = a => { access = Object.assign({ writable: false }, a); };
  const writable = () => !!cfg().team || access.writable;
  let cache = null;
  async function remoteAll(force) {
    if (cache && !force && Date.now() - cache.t < 60000) return cache.items;
    const d = await rpost({ action: 'list' }); if (!d.ok) throw new Error(d.error || 'อ่านคลังกลางไม่ได้');
    cache = { t: Date.now(), items: d.items, deleted: Array.isArray(d.deleted) ? d.deleted : [] }; return d.items;
  }
  async function remotePut(key, val) {
    const all = await remoteAll().catch(() => []), cur = all.find(x => x.key === key), have = (cur && cur.imgs) || {};
    const imgs = {}; Object.entries(val.imgs || {}).forEach(([id, d]) => { if (!have[id] && safeImg(d)) imgs[id] = d; });   // ส่งเฉพาะภาพที่คลังยังไม่มี
    const item = Object.assign({}, val); delete item.imgs; delete item.key;
    const r = await rpost({ action: 'put', key, item, imgs });
    if (!r.ok) throw new Error(r.error);
    if (cache) { const i = cache.items.findIndex(x => x.key === key), v = Object.assign({ key }, item, { imgs: r.imgs }); if (i >= 0) cache.items[i] = v; else cache.items.push(v); }
    return r;
  }
  /** ภาพที่ยอมให้แสดง: data URL ของ JPEG/PNG/WebP เท่านั้น (กันสคริปต์แฝงจากไฟล์/คลังที่ถูกแก้) */
  const IMG_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
  function safeImg(d) { return typeof d === 'string' && IMG_RE.test(d) ? d : null; }
  /** ภาพจากคลัง: ในเครื่องเป็น data URL อยู่แล้ว · คลังกลางเป็น id ไฟล์ Drive → ดึงผ่านสคริปต์ */
  async function libImg(v) {
    if (String(v).startsWith('data:')) return safeImg(v);
    const r = imgRef(v), url = storeUrl(r.store); if (!url) return null;   // ที่เก็บนี้ยังไม่ได้ตั้งค่า URL
    const d = await rpost({ action: 'img', file: v }, Object.assign({}, cfg(), { url })); return d.ok ? safeImg(d.data) : null;
  }
  async function ping(c) { return rpost({ action: 'ping' }, c); }
  async function whoami() { return rpost({ action: 'whoami' }); }

  const imgPut = (id, data) => op('img', 'readwrite', s => s.put(data, id)).catch(() => null);
  const imgGet = id => op('img', 'readonly', s => s.get(id)).then(safeImg).catch(() => null);
  const localPut = (key, val) => op('lib', 'readwrite', s => s.put(val, key)).catch(() => null);
  const localGet = key => op('lib', 'readonly', s => s.get(key)).catch(() => null);
  const localAll = () => op('lib', 'readonly', s => s.getAll()).catch(() => []);
  // คลังกลางถ้าตั้งไว้ (เก็บสำรองในเครื่องด้วย) · ไม่ได้ตั้ง = ในเครื่อง
  async function libPut(key, val) { const cur = await localGet(key); if (cur && cur.aliases) val = Object.assign({}, val, { aliases: Array.from(new Set(cur.aliases.concat(val.aliases || []))) }); await localPut(key, val); if (remote() && writable()) return remotePut(key, val); }
  async function libGet(key) { if (remote()) { const a = await remoteAll().catch(() => null); if (a) return a.find(x => x.key === key) || null; } return localGet(key); }
  async function libAll(force) { if (remote()) { try { return await remoteAll(force); } catch (e) { /* ออฟไลน์ → ในเครื่อง */ } } return localAll(); }
  const libDel = key => op('lib', 'readwrite', s => s.delete(key)).catch(() => null);
  /** ลบรายการออกจากคลังกลาง (สคริปต์ให้เฉพาะผู้ดูแลระบบ/รหัสทีม · ย้ายไปชีต deleted กู้คืนได้) + ลบสำเนาในเครื่อง */
  async function libRemove(key) {
    if (remote()) { const r = await rpost({ action: 'del', key }); if (!r.ok) throw new Error(r.error || 'ลบไม่สำเร็จ'); if (cache) cache.items = cache.items.filter(x => x.key !== key); }
    await libDel(key);
  }
  /** รายการที่ถูกลบจากคลังกลาง [{key, at}] (สคริปต์รุ่นใหม่ส่งมากับ list — รุ่นเดิมได้ []) ใช้กันสำเนาเก่าในเครื่องถูกส่งขึ้นคลังซ้ำ */
  const libDeleted = () => (cache && cache.deleted) || [];

  // ---------------------------------------------------------------- จับคู่วัสดุกับคลัง (ชื่อเขียนต่างกันได้)
  // ชั้น 1 ref: รหัสพาณิชย์ (c:รหัส) หรือรหัสแถวมาตรฐานจากตัวถอดปริมาณ (k:คีย์) · ชั้น 2 ชื่อปรับมาตรฐาน+หน่วย+ตัวเลขสเปก
  // ชั้น 3 ชื่ออื่น (aliases) ที่ผู้ใช้เคยผูกไว้ · ที่เหลือ = "อาจตรงกับ" ให้ผู้ใช้ยืนยัน
  const UNIT_EQ = [[/ตร\.?\s*ม\.?|ตารางเมตร|m2/g, 'ตรม'], [/ลบ\.?\s*ม\.?|ลูกบาศก์เมตร|m3/g, 'ลบม'], [/ตร\.?\s*มม\.?|mm2/g, 'ตรมม'], [/กก\.?|กิโลกรัม|kg/g, 'กก'], [/เมตร|ม\./g, 'ม']];
  function normUnit(u) { let s = String(u || '').toLowerCase().replace(/\s+/g, ''); UNIT_EQ.forEach(([r, t]) => { s = s.replace(r, t); }); return s.replace(/[.]/g, ''); }
  const SYN = [[/พีวีซี/g, 'pvc'], [/พีพีอาร์|พีพี-อาร์|pp-r/g, 'ppr'], [/แอลอีดี/g, 'led'], [/อะลูมิเนียม|อลูมิเนียม|อลูมีเนียม|อะลูมีเนียม/g, 'alu'], [/สแตนเลส|สเตนเลส|สแตนเลสสตีล/g, 'sus'], [/เมทัลชีต|เมทัลชีท|เมทัลชีส/g, 'เมทัลชีท'], [/ซีเมนต์บอร์ด/g, 'ซีเมนต์บอร์ด']];
  const FILLER = /ขนาด|ชนิด|แบบ|หนา|ยาว|กว้าง|สูง|ประมาณ|หรือเทียบเท่า|เทียบเท่า|ยี่ห้อ|รุ่น|วัสดุ|พร้อม/g;
  function normName(n) {
    let t = String(n || '').toLowerCase(); SYN.forEach(([r, w]) => { t = t.replace(r, w); });
    return t
      .replace(/ม\.ม\.|มม\.?|มิลลิเมตร/g, 'mm').replace(/ซม\.?|เซนติเมตร/g, 'cm').replace(/นิ้ว|”|″/g, '"').replace(/⌀|ø|Ø/g, 'ø')
      .replace(FILLER, '').replace(/[\s()\[\]{},;:·\-–_/\\'`]+/g, '').trim();
  }
  /** ตัวเลขสเปกในชื่อ (0.35, 13.5, 1/2, 60x60) — ต้องตรงกันทั้งชุดจึงถือว่าวัสดุเดียวกัน */
  function specNums(n) { return (String(n || '').replace(/,(?=\d{3})/g, '').match(/\d+\/\d+|\d+(?:\.\d+)?/g) || []).map(x => x.replace(/\.0+$/, '')).sort().join('|'); }
  function bigrams(s) { const t = s.replace(/[\d.]+/g, ''), o = new Set(); for (let i = 0; i < t.length - 1; i++) o.add(t.slice(i, i + 2)); return o; }
  function sim(a, b) { const A = bigrams(normName(a)), B = bigrams(normName(b)); if (!A.size || !B.size) return 0; let n = 0; A.forEach(x => { if (B.has(x)) n++; }); return 2 * n / (A.size + B.size); }
  const nkey = (name, unit) => normName(name) + '|' + normUnit(unit);
  /** หารายการในคลังของวัสดุนี้ → { hit: รายการที่ตรงแน่, how, maybe: [{x, score}] } */
  function libFind(all, it) {
    const u = normUnit(it.unit), nk = nkey(it.name, it.unit), k = libKey(it.name, it.unit), nums = specNums(it.name);
    const sameU = all.filter(x => normUnit(x.unit) === u);
    let hit = it.ref && sameU.find(x => x.ref && x.ref === it.ref), how = 'รหัสเดียวกัน';
    if (!hit) { hit = all.find(x => x.key === k); how = 'ชื่อเดียวกัน'; }
    if (!hit) { hit = sameU.find(x => (x.aliases || []).includes(nk)); how = 'เคยผูกชื่อนี้ไว้'; }
    if (!hit) { hit = sameU.find(x => nkey(x.name, x.unit) === nk); how = 'ชื่อใกล้เคียง (ปรับรูปแบบแล้วตรงกัน)'; }
    if (hit) return { hit, how, maybe: [] };
    const maybe = sameU.filter(x => specNums(x.name) === nums).map(x => ({ x, score: sim(x.name, it.name) })).filter(o => o.score >= 0.4)
      .sort((a, b) => b.score - a.score).slice(0, 3);
    return { hit: null, how: '', maybe };
  }
  /** ค้นในคลังด้วยคำ (ให้ผู้ใช้เลือกเอง) — หน่วยเดียวกันขึ้นก่อน */
  function libSearch(all, q, unit) {
    const nq = normName(q), u = normUnit(unit);
    return all.map(x => { const t = normName(x.name).includes(nq) ? 1 : sim(x.name, q); return { x, t, score: t + (normUnit(x.unit) === u ? 0.5 : 0) }; })
      .filter(o => o.t >= 0.3).sort((a, b) => b.score - a.score).slice(0, 12).map(o => o.x);
  }
  /** จำว่า "ชื่อนี้ = รายการนี้ในคลัง" (ไม่เปลี่ยนวันที่สืบ) */
  async function libAlias(key, name, unit) { return libAliasNk(key, nkey(name, unit)); }
  async function libAliasNk(key, nk) {
    const cur = await localGet(key);
    if (cur) { cur.aliases = Array.from(new Set((cur.aliases || []).concat([nk]))); await localPut(key, cur); }
    if (remote() && writable()) { const r = await rpost({ action: 'alias', key, alias: nk }); if (!r.ok) throw new Error(r.error); if (cache) { const x = cache.items.find(i => i.key === key); if (x) x.aliases = r.aliases; } }
  }
  /** รายการในคลังที่เป็น "สำเนา" ของรายการอื่น (เว็บรุ่นก่อน 6.51 ดึงราคาจากคลังแล้วบันทึกกลับเป็นรายการใหม่ตามชื่อแถว BOQ)
   *  x เป็นสำเนาเมื่อทุกรายที่สืบมีหมายเหตุ "จากคลัง" และมีรายการอื่นที่มีรายเดียวกันครบ (ร้าน ราคา วันที่ ช่องทาง)
   *  คืน {orig, how: 'copy'|'partial', sameUnit} หรือ null · partial = บางรายคัดลอกมา บางรายสืบเพิ่มเอง (ให้ผู้ใช้ตัดสินเอง) */
  const qSig = q => [q.channel || '', String(q.shop || '').trim(), +q.price || 0, q.date || ''].join('|');
  const fromLib = q => /จากคลัง/.test(q.note || '');
  function libOrigin(all, x, _d) {
    const qs = (x.quotes || []).filter(q => +q.price > 0), cp = qs.filter(fromLib);
    if (!cp.length) return null;
    const need = new Set(cp.map(qSig));
    const cand = all.filter(y => y.key !== x.key && (y.quotes || []).length).map(y => {
      const ys = new Set((y.quotes || []).map(qSig)); let n = 0; need.forEach(k => { if (ys.has(k)) n++; });
      return { y, n, own: (y.quotes || []).filter(q => +q.price > 0 && !fromLib(q)).length };
    }).filter(o => o.n === need.size).sort((a, b) => (b.own - a.own) || String(a.y.updated || '').localeCompare(String(b.y.updated || '')));
    if (!cand.length) return null;
    let orig = cand[0].y;
    if (!cand[0].own && (_d || 0) < 5) { const up = libOrigin(all.filter(z => z.key !== x.key), orig, (_d || 0) + 1); if (up) orig = up.orig; }   // ต้นฉบับเป็นสำเนาอีกต่อ → ไล่ไปตัวจริง
    return { orig, how: cp.length === qs.length ? 'copy' : 'partial', sameUnit: normUnit(orig.unit) === normUnit(x.unit) };
  }
  /** รายการซ้ำในคลัง (สำเนาที่ถูกคัดลอกจากรายการอื่น) [{x: ตัวซ้ำ, o: libOrigin}] เรียงตามชื่อต้นฉบับ — ใช้ร่วม Cost Hub / Total Station */
  function libDupFind(items) {
    return (items || []).map(x => { const o = libOrigin(items, x); return o ? { x, o } : null; }).filter(Boolean)
      .filter(d => d.o.orig.key !== d.x.key).sort((a, b) => a.o.orig.name.localeCompare(b.o.orig.name, 'th') || a.x.name.localeCompare(b.x.name, 'th'));
  }
  /** รวมตัวซ้ำเข้าต้นฉบับ: ย้ายรายที่สืบเพิ่มเอง (พร้อมภาพ) ไปต้นฉบับ (เฉพาะหน่วยเดียวกัน) · จำชื่อเป็นชื่ออื่นของต้นฉบับ · ลบตัวซ้ำจากคลังกลาง
   *  localImg(id) = ภาพในเครื่อง (กรณีรายการยังไม่ได้อัปโหลดภาพ) — ไม่บังคับ */
  async function libDupMerge(d, localImg) {
    const orig = d.o.orig;
    if (d.o.how === 'partial' && d.o.sameUnit) {
      const sig = new Set((orig.quotes || []).map(qSig));
      const own = (d.x.quotes || []).filter(q => +q.price > 0 && !fromLib(q) && !sig.has(qSig(q)));
      if (own.length) {
        const imgs = {};
        for (const q of own) for (const id of (q.imgs || [])) {
          const v = (d.x.imgs || {})[id]; const data = v ? await libImg(v).catch(() => null) : (localImg ? localImg(id) : null); if (data) imgs[id] = data;
        }
        await libPut(orig.key, { key: orig.key, name: orig.name, unit: orig.unit, quotes: (orig.quotes || []).concat(own), reason: orig.reason || '', imgs, updated: new Date().toISOString(), project: orig.project || '', ref: orig.ref || '', cat: orig.cat || 'mat' });
      }
    }
    if (d.o.sameUnit) { await libAlias(orig.key, d.x.name, d.x.unit); for (const a of (d.x.aliases || [])) await libAliasNk(orig.key, a); }
    await libRemove(d.x.key);
  }
  /* ===== รายงานราคาสืบ (ใช้ร่วม Cost Hub / Total Station — แต่ละเว็บแปลงเป็นไฟล์ด้วยไลบรารีของตัวเอง) ===== */
  const ST_TXT = { ok: 'ครบ 3 ราย', few: 'ไม่ครบ 3 ราย', none: 'ยังไม่สืบ' };
  /** [3,4,5,7] → "3–5, 7" */
  function numRange(a) {
    const out = []; for (let i = 0; i < a.length; i++) { let j = i; while (j + 1 < a.length && a[j + 1] === a[j] + 1) j++; out.push(j > i + 1 ? a[i] + '–' + a[j] : (j === i + 1 ? a[i] + ', ' + a[j] : String(a[i]))); i = j; } return out.join(', ');
  }
  /** เลขภาพหลักฐาน: รายการเรียงตามชื่อ (ตัดรหัสซ้ำ) → รายตามลำดับใน summary → ภาพตามลำดับที่แนบ = "ภาพที่ 1, 2, …"
   *  o.key(it) = รหัสรายการ (ค่าเริ่ม it.key) · o.src(it) = รายการที่เก็บรหัสภาพจริง (เช่น สำเนาในโครงการไม่มีภาพ → ใช้รายการในคลัง)
   *  ได้ { figs:[{n, it: src, item: it, name, unit, q, up, id}], refTxt(key, qid) } */
  function evNumber(items, o) {
    o = o || {}; const keyOf = o.key || (it => it.key), srcOf = o.src || (it => it);
    const seen = new Set(), list = (items || []).filter(it => it && keyOf(it) && !seen.has(keyOf(it)) && seen.add(keyOf(it)))
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'th'));
    const figs = [], refs = {}; let n = 0;
    for (const it of list) {
      const src = srcOf(it) || it, byId = {}; (src.quotes || []).forEach(q => { byId[q.id] = q; });
      for (const x of summary(it).list) {
        const sq = byId[x.q.id], ids = (sq && sq.imgs) || []; if (!ids.length) continue;
        const r = (refs[keyOf(it)] = refs[keyOf(it)] || {})[x.q.id] = [];
        ids.forEach(id => { n++; r.push(n); figs.push({ n, it: src, item: it, name: it.name, unit: it.unit, q: sq, up: x.up, id }); });
      }
    }
    return { figs, refs, refTxt: (key, qid) => { const a = (refs[key] || {})[qid] || []; return a.length ? 'ภาพที่ ' + numRange(a) : ''; } };
  }
  /** ข้อมูล Excel ราคาสืบ 2 แผ่น (ไม่ผูกไลบรารี): { sum, detail } แต่ละแผ่น = { name, aoa, f: {A1: {f, v}} สูตร (รูปแบบ #,##0.00), cols: [ความกว้าง] }
   *  refTxt(key, qid) = ข้อความอ้างภาพ (คอลัมน์ L) · keyOf(it) = รหัสรายการ */
  const SHEET_DETAIL = 'รายละเอียดการสืบ', SHEET_SUM = 'สรุปราคาสืบ';
  function sheetData(list, refTxt, keyOf) {
    keyOf = keyOf || (it => it.key);
    const aoa = [], f = {}, sumRows = [];
    list.forEach((it, idx) => {
      const s = summary(it);
      aoa.push([`${idx + 1}. ${it.name} [หน่วย ${it.unit}]`, '', '', '', '', '', '', '', '']);
      aoa.push(['#', 'ร้าน / บริษัท', 'ช่องทาง', 'เบอร์ / ลิงก์', 'วันที่', 'ราคาที่เสนอ', 'หน่วยร้าน', 'ตัวคูณ (1 หน่วยร้าน = ? ' + it.unit + ')', 'VAT', 'บาท/' + it.unit + ' ไม่รวม VAT', 'หมายเหตุ', 'ภาพหลักฐาน']);
      const first = aoa.length + 1;
      s.list.forEach((x, j) => {
        const q = x.q, r = aoa.length + 1;
        aoa.push([j + 1, q.shop || '', CHANNEL[q.channel] || '', q.contact || '', q.date || '', +q.price, q.qunit || '', +(q.factor || 1), q.vat ? 'รวม VAT' : 'ไม่รวม VAT', '', (q.brand ? 'ยี่ห้อ ' + q.brand + (q.note ? ' · ' : '') : '') + (q.note || ''), refTxt ? refTxt(keyOf(it), q.id) : '']);
        f['J' + r] = { f: `ROUND(IF(I${r}="รวม VAT",F${r}/1.07,F${r})/H${r},2)`, v: x.up };
      });
      const last = aoa.length, tr = aoa.length + 1;
      aoa.push(['', '', '', '', '', '', '', '', 'ราคาที่ใช้ (ต่ำสุด)', '', s.n < MIN_Q ? `สืบได้ ${s.n} ราย (ไม่ครบ ${MIN_Q})${it.reason ? ' — ' + it.reason : ''}` : '']);
      f['J' + tr] = { f: `MIN(J${first}:J${last})`, v: s.price };
      aoa.push([]);
      sumRows.push({ it, s, tr, upd: it.updated ? String(it.updated).slice(0, 10) : '' });
    });
    const sum = [['#', 'รายการวัสดุ', 'หน่วย', 'จำนวนราย', 'ราคาที่ใช้ (บาท/หน่วย ไม่รวม VAT)', 'สถานะ', 'วันที่สืบล่าสุด']], f2 = {};
    sumRows.forEach((o, i) => { sum.push([i + 1, o.it.name, o.it.unit, o.s.n, '', ST_TXT[o.s.status], o.upd]); f2['E' + (i + 2)] = { f: `'${SHEET_DETAIL}'!J${o.tr}`, v: o.s.price }; });
    return {
      sum: { name: SHEET_SUM, aoa: sum, f: f2, cols: [5, 52, 10, 11, 30, 16, 16] },
      detail: { name: SHEET_DETAIL, aoa, f, cols: [5, 28, 12, 26, 12, 14, 12, 22, 14, 20, 30, 16] },
    };
  }
  function libMatch(all, name, unit) { const f = libFind(all, { name, unit }); return f.hit ? [f.hit] : f.maybe.map(o => o.x); }   // ใช้กับโค้ดเดิม

  /** วัสดุมวลรวมที่สร้างเอง (คลังกลาง ใช้ร่วมกันทั้งทีม) */
  async function compList() { if (!remote()) return []; const d = await rpost({ action: 'clist' }); if (!d.ok) throw new Error(d.error || 'โหลดวัสดุมวลรวมที่สร้างเองไม่สำเร็จ'); return d.comps || []; }
  async function compPut(id, comp) { const d = await rpost({ action: 'cput', id: id || '', comp }); if (!d.ok) throw new Error(d.error || 'บันทึกไม่สำเร็จ'); return d.comp; }
  async function compDel(id) { const d = await rpost({ action: 'cdel', id }); if (!d.ok) throw new Error(d.error || 'ลบไม่สำเร็จ'); return true; }
  return { compList, compPut, compDel, cfg, setCfg, remote, ping, whoami, imgRef, setAccess, writable, libImg, safeImg, localAll, VAT, MIN_Q, CHANNEL, uid, unitPrice, summary, srcText, compress, libKey, libMatch, libFind, libSearch, libAlias, libAliasNk, libOrigin, libDupFind, libDupMerge, numRange, evNumber, sheetData, ST_TXT, libRemove, quoteSig: qSig, libDeleted, normName, normUnit, specNums, ageDays, imgPut, imgGet, libPut, libGet, libAll, libDel, r2 };
});
