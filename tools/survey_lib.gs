/**
 * UD Total Station — คลังราคาสืบกลาง (Google Apps Script Web App)
 * ข้อมูลราคาสืบเก็บในชีต "library" · ภาพหลักฐานเก็บในโฟลเดอร์ Drive "UD Survey Images" (ส่วนตัว ไม่แชร์ลิงก์)
 * การเข้าถึง (3 แบบ):
 *   1) รหัสทีม (TEAM_KEY, แบบเดิม — ใช้ได้ทุกคำสั่ง; Total Station ยังใช้อยู่) · เดาผิดเกิน 20 ครั้งใน 10 นาที → ปิดรับ 10 นาที
 *   2) ล็อกอิน Google ผ่าน Firebase (ส่ง token): ผู้ใช้ทุกคนที่ล็อกอินอ่านรายการ+หลักฐาน+ภาพได้ ·
 *      แก้ไข/เพิ่มได้เมื่อมีเอกสาร access/{uid} ใน Firestore = {status:'approved', role:'editor'|'admin'} · ลบได้เฉพาะ admin
 *   3) ไม่ล็อกอิน: คำสั่ง list ได้มุมมองสาธารณะ (ราคา/จำนวนราย/วันที่) ไม่มีชื่อร้าน ช่องทางติดต่อ หมายเหตุ ภาพ ผู้บันทึก
 *
 * วิธีติดตั้ง (ครั้งเดียว):
 *  1) script.google.com → New project → วางไฟล์นี้ → Project Settings → ติ๊ก Show "appsscript.json" → วาง appsscript.json (ท้ายไฟล์นี้) → Save
 *  2) เลือกฟังก์ชัน setup → ▷ เรียกใช้ (อนุญาตสิทธิ์) — สร้างชีต "UD คลังราคาสืบ" + โฟลเดอร์ภาพให้เอง
 *  3) Project Settings → Script properties → Add: TEAM_KEY = <รหัสทีม อย่างน้อย 12 ตัว>
 *  4) Deploy → New deployment → Web app · Execute as: Me · Who has access: Anyone → Deploy → คัดลอก Web app URL
 *  5) เอา URL ใส่ใน lib/version.js (LIB_URL) หรือในเว็บ (แท็บราคาสืบ → ตั้งค่าคลังกลาง)
 *
 * เว็บเรียกแบบ POST text/plain (ไม่มี preflight, รหัสไม่อยู่ใน URL): list / img / ping / whoami / put / del / alias
 *
 * ติดตั้งเพิ่มสำหรับการล็อกอิน: ใช้ appsscript.json ฉบับใหม่ (เพิ่ม scope script.external_request) แล้ว Deploy → Manage deployments → แก้ไขเวอร์ชันของ deployment เดิม (URL เดิมไม่เปลี่ยน)
 *
 * appsscript.json (จำกัดสิทธิ์: ชีต + เฉพาะไฟล์ Drive ที่สคริปต์สร้างเอง) — ไฟล์เต็มอยู่ที่ tools/survey_lib.appsscript.json:
 * { "timeZone": "Asia/Bangkok", "exceptionLogging": "STACKDRIVER", "runtimeVersion": "V8",
 *   "oauthScopes": ["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/drive.file"],
 *   "webapp": { "executeAs": "USER_DEPLOYING", "access": "ANYONE_ANONYMOUS" } }
 */
const SHEET = 'library', TRASH = 'deleted', FOLDER = 'UD Survey Images';
const SHEET_ID = '';   // ว่างไว้ได้: ใช้ชีตที่ setup() สร้าง (เก็บ id ใน Script properties)
const HEAD = ['key', 'name', 'unit', 'quotes', 'reason', 'updated', 'project', 'by', 'imgs', 'ref', 'aliases'];   // ref = รหัสพาณิชย์/รหัสแถวมาตรฐาน · aliases = ชื่ออื่นที่ผูกไว้
const IMG_MAX = 2.8e6, IMG_PER_PUT = 10, IMG_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const FAIL_MAX = 20, FAIL_WIN = 600;   // เดาผิดได้ 20 ครั้ง / 10 นาที
const FB_KEY = 'AIzaSyBCu-4j-j0CUzeghcifinApGAjdZoYBgAI', FB_PROJECT = 'ud-cost-hub-88a5a';   // ค่าสาธารณะของโปรเจกต์ Firebase (ความปลอดภัยอยู่ที่การตรวจ token + กฎ Firestore)
const LOG = 'log', USER_TTL = 120;   // ผลตรวจผู้ใช้เก็บในแคช 2 นาที (อนุมัติ/ถอนสิทธิ์มีผลภายใน 2 นาที)

function props_() { return PropertiesService.getScriptProperties(); }
function ss_() {
  const id = SHEET_ID || props_().getProperty('SHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}
function tab_(name) {
  const ss = ss_(); let sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.appendRow(name === TRASH ? HEAD.concat(['deleted_at']) : HEAD); sh.setFrozenRows(1); sh.getRange('A:L').setNumberFormat('@'); }
  else if (name === SHEET && sh.getLastColumn() < HEAD.length) { sh.getRange(1, 1, 1, HEAD.length).setValues([HEAD]); sh.getRange('A:K').setNumberFormat('@'); }   // เพิ่มคอลัมน์ใหม่ให้ชีตเดิม
  return sh;
}
/** ที่เก็บภาพของสคริปต์นี้: Script property STORE (ว่าง = 'main' = แบบเดิม ค่าภาพเป็นรหัสไฟล์เปล่า ๆ)
 *  ถ้าย้ายไปสคริปต์/บัญชี Drive ใหม่ ตั้ง STORE เป็นชื่ออื่น (เช่น s2) ภาพใหม่จะบันทึกเป็น "s2:รหัสไฟล์" และเว็บจะรู้ว่าต้องถามสคริปต์ไหน */
const store_ = () => props_().getProperty('STORE') || 'main';
function imgRef_(v) { const m = String(v).match(/^([A-Za-z0-9_-]{1,20}):(.+)$/); return m ? { store: m[1], file: m[2] } : { store: 'main', file: String(v) }; }
function folder_() {
  const id = props_().getProperty('FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* สร้างใหม่ */ } }
  const it = DriveApp.getFoldersByName(FOLDER);   // โฟลเดอร์เดิมที่สคริปต์นี้สร้างไว้
  const f = it.hasNext() ? it.next() : DriveApp.createFolder(FOLDER); props_().setProperty('FOLDER_ID', f.getId()); return f;
}
/** รันในตัวแก้ไข (▷ เรียกใช้ setup): สร้างชีต/โฟลเดอร์ + ปิดแชร์ภาพเดิม — รันซ้ำได้ */
function setup() {
  let ss = null; try { ss = ss_(); } catch (e) { ss = null; }
  if (!ss) { ss = SpreadsheetApp.create('UD คลังราคาสืบ'); props_().setProperty('SHEET_ID', ss.getId()); }
  tab_(SHEET).getRange('A:I').setNumberFormat('@'); tab_(TRASH);
  const fd = folder_(), it = fd.getFiles(); let n = 0;
  while (it.hasNext()) { const f = it.next(); if (f.getSharingAccess() !== DriveApp.Access.PRIVATE) { f.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE); n++; } }
  const k = props_().getProperty('TEAM_KEY') || '';
  Logger.log('ชีตคลัง: ' + ss.getUrl() + ' · ปิดแชร์ภาพ ' + n + ' ไฟล์' + (k.length < 12 ? ' · คำเตือน: TEAM_KEY ควรยาวอย่างน้อย 12 ตัว' : ''));
}

function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
/** กันข้อความกลายเป็นสูตรในชีต (= + - @) */
function txt_(v) { const s = String(v == null ? '' : v); return /^[=+\-@\t\r]/.test(s) ? "'" + s : s; }
function rows_(sh) {
  const v = (sh || tab_(SHEET)).getDataRange().getValues(); v.shift();
  const un = s => String(s).replace(/^'/, '');
  return v.map((r, i) => ({ row: i + 2, r })).filter(x => x.r[0]).map(({ row, r }) => ({ row, key: un(r[0]), name: un(r[1]), unit: un(r[2]), quotes: JSON.parse(r[3] || '[]'), reason: un(r[4]), updated: un(r[5]), project: un(r[6]), by: un(r[7]), imgs: JSON.parse(r[8] || '{}'), ref: un(r[9] || ''), aliases: JSON.parse(r[10] || '[]') }));
}
function same_(a, b) {   // เทียบแบบเวลาคงที่
  a = String(a); b = String(b); let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}
function auth_(team) {
  const c = CacheService.getScriptCache(), fails = +(c.get('fails') || 0);
  if (fails >= FAIL_MAX) return 'ใส่รหัสผิดหลายครั้ง ปิดรับชั่วคราว 10 นาที';
  const key = props_().getProperty('TEAM_KEY');
  if (key && team && same_(team, key)) return '';
  c.put('fails', String(fails + 1), FAIL_WIN);
  return 'รหัสทีมไม่ถูกต้อง';
}

/* ---------- ล็อกอินผ่าน Firebase ---------- */
function hex_(bytes) { return bytes.map(b => ('0' + (b & 255).toString(16)).slice(-2)).join(''); }
function fsStr_(doc, k) { const f = doc && doc.fields && doc.fields[k]; return f && f.stringValue !== undefined ? String(f.stringValue) : ''; }
function fsGet_(path, token) {   // อ่านเอกสาร Firestore ด้วยสิทธิ์ของผู้ใช้เอง (ผ่านกฎความปลอดภัย)
  const r = UrlFetchApp.fetch('https://firestore.googleapis.com/v1/projects/' + FB_PROJECT + '/databases/(default)/documents/' + path,
    { method: 'get', headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
  if (r.getResponseCode() === 404) return null;
  if (r.getResponseCode() !== 200) throw new Error('อ่านข้อมูลผู้ใช้ไม่ได้ (' + r.getResponseCode() + ')');
  return JSON.parse(r.getContentText());
}
/** ตรวจ ID token ของ Firebase → {uid, email, name, position, agency, status, role} หรือ null ถ้า token ไม่ถูกต้อง/หมดอายุ */
function user_(token) {
  token = String(token || ''); if (token.length < 100 || token.length > 4000) return null;
  const c = CacheService.getScriptCache(), ck = 'u:' + hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token));
  const hit = c.get(ck); if (hit) return JSON.parse(hit);
  const r = UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + FB_KEY,
    { method: 'post', contentType: 'application/json', payload: JSON.stringify({ idToken: token }), muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) return null;
  const u = (JSON.parse(r.getContentText()).users || [])[0];
  if (!u || !u.localId || !u.email || !u.emailVerified) return null;
  const acc = fsGet_('access/' + u.localId, token) , pro = fsGet_('profiles/' + u.localId, token);
  const st = fsStr_(acc, 'status'), role = fsStr_(acc, 'role');
  const out = { uid: u.localId, email: u.email, name: fsStr_(pro, 'name') || u.displayName || '', position: fsStr_(pro, 'position'), agency: fsStr_(pro, 'agency'),
    status: st === 'approved' ? 'approved' : 'pending', role: ['admin', 'editor', 'viewer'].indexOf(role) >= 0 ? role : 'viewer' };
  c.put(ck, JSON.stringify(out), USER_TTL);
  return out;
}
const canWrite_ = u => u.status === 'approved' && (u.role === 'editor' || u.role === 'admin');
const canDel_ = u => u.status === 'approved' && u.role === 'admin';
/** ข้อความผู้บันทึกที่เซิร์ฟเวอร์ตั้งเอง (ไม่เชื่อค่าที่เว็บส่งมา) */
const by_ = u => (u.name || u.email) + (u.position ? ' (' + u.position + (u.agency ? ', ' + u.agency : '') + ')' : (u.agency ? ' (' + u.agency + ')' : '')) + ' <' + u.email + '>';
/** มุมมองสาธารณะ (ไม่ล็อกอิน): ราคาและจำนวนราย ไม่มีชื่อร้าน/ช่องทางติดต่อ/หมายเหตุ/ภาพ/ผู้บันทึก */
function pub_(x) {
  return { key: x.key, name: x.name, unit: x.unit, reason: '', updated: x.updated, project: '', by: '', imgs: {}, ref: x.ref, aliases: x.aliases,
    quotes: (x.quotes || []).map(q => ({ id: q.id, channel: q.channel, date: q.date, price: q.price, qunit: q.qunit, factor: q.factor, vat: q.vat })) };
}
function log_(act, key, who) {
  try {
    const ss = ss_(); let sh = ss.getSheetByName(LOG);
    if (!sh) { sh = ss.insertSheet(LOG); sh.appendRow(['time', 'action', 'key', 'who']); sh.setFrozenRows(1); }
    sh.appendRow([new Date().toISOString(), act, txt_(key), txt_(who)]);
  } catch (e) { /* บันทึกประวัติไม่สำเร็จไม่ควรทำให้คำสั่งหลักล้ม */ }
}

function doGet() { return out_({ ok: true, app: 'ud-survey-lib', note: 'ใช้ POST (รหัสทีม หรือ token ล็อกอิน)' }); }

function doPost(e) {
  let b;
  try { b = JSON.parse(e.postData.contents); } catch (err) { return out_({ ok: false, error: 'คำขอไม่ถูกต้อง' }); }
  let ctx = { kind: 'anon' };   // team = รหัสทีม · user = ล็อกอิน · anon = ไม่ล็อกอิน
  if (b.team) { const bad = auth_(b.team); if (bad) return out_({ ok: false, error: bad, auth: true }); ctx = { kind: 'team', who: 'รหัสทีม' }; }
  else if (b.token) {
    let u = null; try { u = user_(b.token); } catch (err) { return out_({ ok: false, error: String(err.message || err) }); }
    if (!u) return out_({ ok: false, error: 'การล็อกอินหมดอายุหรือไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่', auth: true });
    ctx = { kind: 'user', user: u, who: by_(u) };
  }
  const isWrite = ['put', 'del', 'alias'].indexOf(b.action) >= 0;
  if (ctx.kind === 'anon' && b.action !== 'list' && b.action !== 'whoami') return out_({ ok: false, error: 'ต้องเข้าสู่ระบบก่อน', auth: true });
  if (ctx.kind === 'user' && isWrite) {
    if (b.action === 'del' ? !canDel_(ctx.user) : !canWrite_(ctx.user)) return out_({ ok: false, error: b.action === 'del' ? 'เฉพาะผู้ดูแลระบบที่ลบรายการได้' : 'บัญชีนี้ยังไม่ได้รับอนุมัติให้แก้ไขคลังกลาง กรุณาติดต่อผู้ดูแลระบบ', auth: true, status: ctx.user.status });
  }
  try {
    if (b.action === 'whoami') return out_({ ok: true, kind: ctx.kind, user: ctx.user ? { email: ctx.user.email, name: ctx.user.name, status: ctx.user.status, role: ctx.user.role } : null });
    if (b.action === 'ping') return out_({ ok: true, name: ss_().getName() });
    if (b.action === 'list') return out_({ ok: true, items: rows_().map(x => { delete x.row; return ctx.kind === 'anon' ? pub_(x) : x; }), view: ctx.kind === 'anon' ? 'public' : 'full' });
    if (b.action === 'img') {   // คืนภาพเป็น data URL — เฉพาะไฟล์ในโฟลเดอร์คลัง
      const ref = imgRef_(b.file);
      if (ref.store !== store_()) return out_({ ok: false, error: 'ภาพอยู่ที่เก็บ "' + ref.store + '" ไม่ใช่ที่เก็บนี้' });
      const f = DriveApp.getFileById(ref.file), fid = folder_().getId();
      let inLib = false; const ps = f.getParents(); while (ps.hasNext()) if (ps.next().getId() === fid) inLib = true;
      if (!inLib) return out_({ ok: false, error: 'ไม่ใช่ภาพในคลัง' });
      return out_({ ok: true, data: 'data:' + f.getMimeType() + ';base64,' + Utilities.base64Encode(f.getBlob().getBytes()) });
    }
    if (['put', 'del', 'alias'].indexOf(b.action) < 0) return out_({ ok: false, error: 'unknown action' });
    const lock = LockService.getScriptLock(); lock.waitLock(20000);
    try {
      const sh = tab_(SHEET), cur = rows_(sh).find(x => x.key === b.key);
      if (b.action === 'del') {   // ย้ายไปชีต deleted (กู้คืนได้)
        if (cur) { const r = sh.getRange(cur.row, 1, 1, HEAD.length).getValues()[0]; tab_(TRASH).appendRow(r.concat([new Date().toISOString()])); sh.deleteRow(cur.row); }
        log_('del', b.key, ctx.who); return out_({ ok: true });
      }
      if (b.action === 'alias') {   // จำชื่ออื่นของรายการ (ไม่เปลี่ยนวันที่สืบ)
        if (!cur) return out_({ ok: false, error: 'ไม่พบรายการในคลัง' });
        const al = String(b.alias || '').slice(0, 300); if (!al) return out_({ ok: false, error: 'alias ว่าง' });
        const list = cur.aliases.indexOf(al) < 0 ? cur.aliases.concat([al]).slice(-50) : cur.aliases;
        sh.getRange(cur.row, 11).setValue(JSON.stringify(list)); log_('alias', b.key, ctx.who); return out_({ ok: true, aliases: list });
      }
      const it = b.item || {}; if (ctx.kind === 'user') it.by = ctx.who;
      if (!b.key || String(b.key).length > 300) return out_({ ok: false, error: 'key ไม่ถูกต้อง' });
      if (cur && cur.updated && it.updated && String(cur.updated) > String(it.updated)) return out_({ ok: false, error: 'คลังมีข้อมูลใหม่กว่า', item: cur });
      const add = Object.keys(b.imgs || {}).filter(id => !(cur && cur.imgs[id]));
      if (add.length > IMG_PER_PUT) return out_({ ok: false, error: 'ภาพเกิน ' + IMG_PER_PUT + ' ภาพต่อครั้ง' });
      const imgs = cur ? cur.imgs : {}, fd = add.length ? folder_() : null;
      for (const id of add) {
        const m = String(b.imgs[id]).match(/^data:(image\/[a-z]+);base64,([A-Za-z0-9+/=]+)$/);
        if (!m || IMG_TYPES.indexOf(m[1]) < 0) return out_({ ok: false, error: 'รับเฉพาะภาพ JPEG/PNG/WebP' });
        if (m[2].length > IMG_MAX) return out_({ ok: false, error: 'ภาพใหญ่เกิน 2 MB' });
        if (!/^[A-Za-z0-9_-]{1,60}$/.test(id)) return out_({ ok: false, error: 'id ภาพไม่ถูกต้อง' });
        { const fileId = fd.createFile(Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], id + '.jpg')).getId(); imgs[id] = store_() === 'main' ? fileId : store_() + ':' + fileId; }   // ไม่แชร์ลิงก์ (ส่วนตัว)
      }
      const row = [txt_(b.key), txt_(it.name), txt_(it.unit), JSON.stringify(it.quotes || []), txt_(it.reason), txt_(it.updated || new Date().toISOString()), txt_(it.project), txt_(it.by), JSON.stringify(imgs), txt_(String(it.ref || '').slice(0, 120)), JSON.stringify(Array.from(new Set((cur ? cur.aliases : []).concat(Array.isArray(it.aliases) ? it.aliases.map(a => String(a).slice(0, 300)) : []))).slice(-50))];
      if (cur) sh.getRange(cur.row, 1, 1, row.length).setValues([row]); else sh.appendRow(row);
      log_(cur ? 'edit' : 'add', b.key, ctx.who);
      return out_({ ok: true, imgs });
    } finally { lock.releaseLock(); }
  } catch (err) { return out_({ ok: false, error: String(err) }); }
}
