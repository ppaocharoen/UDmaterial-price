/* UD Survey — ราคาสืบ (ตกลงกับ Earth 18 ต.ค. 2569)
 * วัสดุ 1 รายการ สืบหลายเจ้า (ปกติ 3) เลือกเจ้าที่ต่ำสุด; ราคาที่รวม VAT ให้หัก VAT (÷ 1.07); แปลงหน่วยร้านเป็นหน่วยใน ปร. ด้วยตัวคูณ
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

  /** ราคาต่อหน่วย ปร. ไม่รวม VAT ของเจ้าหนึ่ง (null ถ้ายังไม่ครบ) */
  function unitPrice(q) {
    const p = +q.price, f = +(q.factor || 1);
    if (!(p > 0) || !(f > 0)) return null;
    return r2((q.vat ? p / (1 + VAT) : p) / f);
  }
  /** สรุปรายการ: ราคาที่ใช้ (ต่ำสุด), จำนวนเจ้า, เจ้าที่เลือก, สถานะ */
  function summary(item) {
    const list = (item.quotes || []).map(q => ({ q, up: unitPrice(q) })).filter(x => x.up !== null);
    if (!list.length) return { price: null, n: 0, best: null, status: 'none', list };
    const best = list.reduce((a, b) => (b.up < a.up ? b : a));
    return { price: best.up, n: list.length, best: best.q, status: list.length >= MIN_Q ? 'ok' : 'few', list };
  }
  function srcText(item) {
    const s = summary(item); if (s.price === null) return '';
    return `ราคาสืบ ต่ำสุดจาก ${s.n} เจ้า: ${s.best.shop || CHANNEL[s.best.channel] || ''}${s.best.date ? ' (' + s.best.date + ')' : ''}`;
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
  function root_lib() { try { return (typeof UD_VERSION !== 'undefined' && UD_VERSION.LIB_URL) || ''; } catch (e) { return ''; } }
  function setCfg(c) {
    const keep = Object.assign({}, c); if (!c.remember) delete keep.team;
    try { localStorage.setItem(CFG_KEY, JSON.stringify(keep)); } catch (e) { /* */ }
    try { if (c.remember || !c.team) sessionStorage.removeItem(TEAM_SS); else sessionStorage.setItem(TEAM_SS, c.team); } catch (e) { /* */ }
    cache = null;
  }
  const remote = () => !!cfg().url;
  /** เรียกคลังกลาง: POST text/plain (ไม่มี preflight) รหัสอยู่ใน body ไม่อยู่ใน URL */
  async function rpost(body, c) {
    c = c || cfg(); if (!c.team) throw new Error('ต้องใส่รหัสทีมก่อน (ตั้งค่าคลังกลาง)');
    const r = await fetch(c.url, { method: 'POST', body: JSON.stringify(Object.assign({ team: c.team }, body)), headers: { 'Content-Type': 'text/plain;charset=utf-8' }, redirect: 'follow' });
    const d = await r.json(); if (!d.ok && d.auth) throw new Error(d.error); return d;
  }
  let cache = null;
  async function remoteAll(force) {
    if (cache && !force && Date.now() - cache.t < 60000) return cache.items;
    const d = await rpost({ action: 'list' }); if (!d.ok) throw new Error(d.error || 'อ่านคลังกลางไม่ได้');
    cache = { t: Date.now(), items: d.items }; return d.items;
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
  async function libImg(v) { if (String(v).startsWith('data:')) return safeImg(v); const d = await rpost({ action: 'img', file: v }); return d.ok ? safeImg(d.data) : null; }
  async function ping(c) { return rpost({ action: 'ping' }, c); }

  const imgPut = (id, data) => op('img', 'readwrite', s => s.put(data, id)).catch(() => null);
  const imgGet = id => op('img', 'readonly', s => s.get(id)).then(safeImg).catch(() => null);
  const localPut = (key, val) => op('lib', 'readwrite', s => s.put(val, key)).catch(() => null);
  const localGet = key => op('lib', 'readonly', s => s.get(key)).catch(() => null);
  const localAll = () => op('lib', 'readonly', s => s.getAll()).catch(() => []);
  // คลังกลางถ้าตั้งไว้ (เก็บสำรองในเครื่องด้วย) · ไม่ได้ตั้ง = ในเครื่อง
  async function libPut(key, val) { const cur = await localGet(key); if (cur && cur.aliases) val = Object.assign({}, val, { aliases: Array.from(new Set(cur.aliases.concat(val.aliases || []))) }); await localPut(key, val); if (remote()) return remotePut(key, val); }
  async function libGet(key) { if (remote()) { const a = await remoteAll().catch(() => null); if (a) return a.find(x => x.key === key) || null; } return localGet(key); }
  async function libAll(force) { if (remote()) { try { return await remoteAll(force); } catch (e) { /* ออฟไลน์ → ในเครื่อง */ } } return localAll(); }
  const libDel = key => op('lib', 'readwrite', s => s.delete(key)).catch(() => null);

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
  async function libAlias(key, name, unit) {
    const nk = nkey(name, unit), cur = await localGet(key);
    if (cur) { cur.aliases = Array.from(new Set((cur.aliases || []).concat([nk]))); await localPut(key, cur); }
    if (remote()) { const r = await rpost({ action: 'alias', key, alias: nk }); if (!r.ok) throw new Error(r.error); if (cache) { const x = cache.items.find(i => i.key === key); if (x) x.aliases = r.aliases; } }
  }
  function libMatch(all, name, unit) { const f = libFind(all, { name, unit }); return f.hit ? [f.hit] : f.maybe.map(o => o.x); }   // ใช้กับโค้ดเดิม

  return { cfg, setCfg, remote, ping, libImg, safeImg, localAll, VAT, MIN_Q, CHANNEL, uid, unitPrice, summary, srcText, compress, libKey, libMatch, libFind, libSearch, libAlias, normName, normUnit, specNums, ageDays, imgPut, imgGet, libPut, libGet, libAll, libDel, r2 };
});
