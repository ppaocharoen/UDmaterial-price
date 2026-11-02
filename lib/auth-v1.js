/* UD Auth — ล็อกอินด้วยบัญชี Google (Firebase Authentication) + ข้อมูลผู้ใช้ (Firestore)
 * โครงสร้างข้อมูล (กฎความปลอดภัยอยู่ที่ Firebase Console):
 *   profiles/{uid}  ชื่อ ตำแหน่ง หน่วยงาน เบอร์โทร — เจ้าของแก้ได้
 *   access/{uid}    {status:'approved'|'pending', role:'admin'|'editor'|'viewer'} — เจ้าของอ่านได้อย่างเดียว ผู้ดูแลแก้ผ่านคอนโซล
 * ใช้งาน: window.UDAuth.on(fn) รับสถานะ {ready, user, profile, access, error} ทุกครั้งที่เปลี่ยน */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { getFirestore, doc, getDoc, setDoc } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const firebaseConfig = {   // ค่านี้เป็นค่าสาธารณะ ความปลอดภัยอยู่ที่กฎ Firestore และรายการโดเมนที่อนุญาต
  apiKey: 'AIzaSyBCu-4j-j0CUzeghcifinApGAjdZoYBgAI',
  authDomain: 'ud-cost-hub-88a5a.firebaseapp.com',
  projectId: 'ud-cost-hub-88a5a',
  storageBucket: 'ud-cost-hub-88a5a.firebasestorage.app',
  messagingSenderId: '712094367788',
  appId: '1:712094367788:web:e117fec42a58c0625f5189'
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
auth.languageCode = 'th';

const state = { ready: false, user: null, profile: null, access: null, error: '' };
const subs = [];
const emit = () => subs.forEach(f => { try { f(Object.assign({}, state)); } catch (e) { /* */ } });

const ERR = {
  'auth/popup-closed-by-user': '', 'auth/cancelled-popup-request': '',
  'auth/popup-blocked': 'เบราว์เซอร์บล็อกหน้าต่างล็อกอิน กรุณาอนุญาตป๊อปอัปของเว็บนี้แล้วลองใหม่',
  'auth/unauthorized-domain': 'โดเมนนี้ยังไม่ได้รับอนุญาตในการตั้งค่า Firebase',
  'auth/network-request-failed': 'เชื่อมต่ออินเทอร์เน็ตไม่ได้ กรุณาลองใหม่',
  'permission-denied': 'ไม่มีสิทธิ์อ่าน/เขียนข้อมูลนี้ (กฎความปลอดภัยของ Firestore)'
};
const errText = e => { const c = e && (e.code || ''); return c in ERR ? ERR[c] : 'เกิดข้อผิดพลาด: ' + (c || (e && e.message) || e); };

async function loadUserData(u) {
  state.profile = null; state.access = null;
  try {
    const [p, a] = await Promise.all([getDoc(doc(db, 'profiles', u.uid)), getDoc(doc(db, 'access', u.uid))]);
    state.profile = p.exists() ? p.data() : null;
    state.access = a.exists() ? a.data() : { status: 'pending', role: 'viewer' };
    state.error = '';
  } catch (e) { state.error = errText(e); }
}

onAuthStateChanged(auth, async u => {
  state.user = u ? { uid: u.uid, email: u.email || '', name: u.displayName || '', photo: u.photoURL || '' } : null;
  if (u) await loadUserData(u); else { state.profile = null; state.access = null; state.error = ''; }
  state.ready = true; emit();
});

window.UDAuth = {
  on(fn) { subs.push(fn); if (state.ready) fn(Object.assign({}, state)); },
  state: () => Object.assign({}, state),
  async signIn() { try { state.error = ''; await signInWithPopup(auth, new GoogleAuthProvider()); } catch (e) { state.error = errText(e); emit(); } },
  async signOut() { try { await signOut(auth); } catch (e) { state.error = errText(e); emit(); } },
  /** บันทึกข้อมูลผู้ใช้ — p = {name, position, agency, phone} */
  async saveProfile(p) {
    if (!auth.currentUser) throw new Error('ยังไม่ได้ล็อกอิน');
    const clean = s => String(s || '').trim().slice(0, 200);
    const v = { name: clean(p.name), position: clean(p.position), agency: clean(p.agency), phone: clean(p.phone), email: auth.currentUser.email || '', updatedAt: Date.now() };
    if (!(state.profile && state.profile.consentAt)) v.consentAt = Date.now(); else v.consentAt = state.profile.consentAt;
    await setDoc(doc(db, 'profiles', auth.currentUser.uid), v);
    state.profile = v; emit(); return v;
  },
  async refresh() { if (auth.currentUser) { await loadUserData(auth.currentUser); emit(); } },
  /** โทเคนสำหรับส่งให้คลังกลาง (Apps Script) ตรวจสอบ */
  async token() { return auth.currentUser ? auth.currentUser.getIdToken() : ''; }
};
window.dispatchEvent(new Event('udauth-loaded'));
