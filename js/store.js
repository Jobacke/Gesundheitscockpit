// Datenschicht: Firebase (Login + Firestore mit Offline-Cache) oder Demo-Modus (localStorage).
// Datenmodell: users/{uid}                → { einstellungen: {...} }
//              users/{uid}/health/{JJJJ-MM-TT} → { datum, gewicht, ruhepuls, hrv, schlaf{…}, bdMessungen[], bdTagesmittel } (vom Empfänger)
//              users/{uid}/tage/{JJJJ-MM-TT} → { datum, gewicht, bdMorgen, bdAbend, tabletteMorgen, tabletteAbend, befinden, ruecken, notiz, aktualisiert }

const FB_VERSION = '10.12.2';

export async function createStore(config) {
  return config ? createFirebaseStore(config) : createDemoStore();
}

async function createFirebaseStore(config) {
  const base = `https://www.gstatic.com/firebasejs/${FB_VERSION}/`;
  const [appMod, authMod, fsMod] = await Promise.all([
    import(base + 'firebase-app.js'),
    import(base + 'firebase-auth.js'),
    import(base + 'firebase-firestore.js'),
  ]);
  const { initializeApp } = appMod;
  const {
    getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut,
    setPersistence, browserLocalPersistence, sendPasswordResetEmail,
  } = authMod;
  const {
    initializeFirestore, getFirestore, persistentLocalCache, persistentSingleTabManager,
    doc, getDoc, setDoc, collection, query, where, getDocs, serverTimestamp,
  } = fsMod;

  const app = initializeApp(config);
  const auth = getAuth(app);
  await setPersistence(auth, browserLocalPersistence);

  let db;
  try {
    db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentSingleTabManager() }) });
  } catch (e) {
    console.warn('Offline-Cache nicht verfügbar, nutze Standard', e);
    db = getFirestore(app);
  }

  const uid = () => {
    if (!auth.currentUser) throw new Error('Nicht angemeldet');
    return auth.currentUser.uid;
  };
  const dayRef = (d) => doc(db, 'users', uid(), 'tage', d);
  const userRef = () => doc(db, 'users', uid());

  return {
    mode: 'firebase',
    onAuth(cb) { onAuthStateChanged(auth, (u) => cb(u ? { email: u.email, uid: u.uid } : null)); },
    login: (email, pass) => signInWithEmailAndPassword(auth, email, pass),
    logout: () => signOut(auth),
    resetPassword: (email) => sendPasswordResetEmail(auth, email),

    async getDay(d) {
      const s = await getDoc(dayRef(d));
      return s.exists() ? s.data() : {};
    },
    // Schreibt sofort in den lokalen Cache; die Synchronisation läuft im Hintergrund.
    saveDay(d, patch) {
      return setDoc(dayRef(d), { ...patch, datum: d, aktualisiert: serverTimestamp() }, { merge: true });
    },
    async getRange(from, to) {
      const q = query(collection(db, 'users', uid(), 'tage'), where('datum', '>=', from), where('datum', '<=', to));
      const snap = await getDocs(q);
      const out = {};
      snap.forEach((s) => { out[s.id] = s.data(); });
      return out;
    },
    async getHealthRange(from, to) {
      const q = query(collection(db, 'users', uid(), 'health'), where('datum', '>=', from), where('datum', '<=', to));
      const snap = await getDocs(q);
      const out = {};
      snap.forEach((s) => { out[s.id] = s.data(); });
      return out;
    },
    async getSettings() {
      const s = await getDoc(userRef());
      return (s.exists() && s.data().einstellungen) || {};
    },
    saveSettings(settings) {
      return setDoc(userRef(), { einstellungen: settings }, { merge: true });
    },
  };
}

function createDemoStore() {
  const KEY = 'gc_demo_tage';
  const SKEY = 'gc_demo_einstellungen';
  const HKEY = 'gc_demo_health';
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
  const write = (all) => localStorage.setItem(KEY, JSON.stringify(all));
  let authCb = null;

  return {
    mode: 'demo',
    onAuth(cb) { authCb = cb; cb({ email: 'demo@lokal', uid: 'demo' }); },
    login: async () => {},
    logout: async () => { authCb && authCb({ email: 'demo@lokal', uid: 'demo' }); },
    resetPassword: async () => {},
    async getDay(d) { return read()[d] || {}; },
    async saveDay(d, patch) {
      const all = read();
      all[d] = { ...(all[d] || {}), ...patch, datum: d };
      write(all);
    },
    async getRange(from, to) {
      const all = read();
      const out = {};
      for (const [k, v] of Object.entries(all)) if (k >= from && k <= to) out[k] = v;
      return out;
    },
    async getHealthRange(from, to) {
      let all = {};
      try { all = JSON.parse(localStorage.getItem(HKEY)) || {}; } catch { all = {}; }
      const out = {};
      for (const [k, v] of Object.entries(all)) if (k >= from && k <= to) out[k] = v;
      return out;
    },
    async getSettings() { try { return JSON.parse(localStorage.getItem(SKEY)) || {}; } catch { return {}; } },
    async saveSettings(s) { localStorage.setItem(SKEY, JSON.stringify(s)); },
    // Nur Demo: Beispieldaten für die letzten Wochen erzeugen bzw. löschen
    seed(days = 75) {
      const all = {};
      const today = new Date();
      for (let i = days; i >= 0; i--) {
        const dt = new Date(today); dt.setDate(today.getDate() - i);
        const d = toKey(dt);
        const r = Math.random();
        const ev = i === 0 ? false : r > 0.12;
        const trend = i / days;
        all[d] = {
          datum: d,
          gewicht: r > 0.1 ? round1(95.6 - (1 - trend) * 1.8 + (Math.random() - 0.5) * 0.8) : null,
          bdMorgen: r > 0.15 ? { sys: Math.round(134 - (1 - trend) * 6 + (Math.random() - 0.5) * 12), dia: Math.round(86 - (1 - trend) * 3 + (Math.random() - 0.5) * 8), puls: Math.round(56 + Math.random() * 8), zeit: '06:41' } : null,
          tabletteMorgen: r > 0.08,
          bdAbend: ev && r > 0.3 ? { sys: Math.round(128 + (Math.random() - 0.5) * 12), dia: Math.round(82 + (Math.random() - 0.5) * 8), puls: Math.round(62 + Math.random() * 8), zeit: '18:07' } : null,
          tabletteAbend: ev && r > 0.2,
          befinden: 3 + Math.round(Math.random() * 2),
          ruecken: Math.round(Math.random() * 4),
        };
      }
      write(all);
      const health = {};
      for (let i = days; i >= 0; i--) {
        const dt = new Date(today); dt.setDate(today.getDate() - i);
        const d = toKey(dt);
        const g = 4.3 + Math.random() * 2.8;
        health[d] = {
          datum: d,
          ruhepuls: Math.round(53 + Math.random() * 5 + (i === 0 ? 3 : 0)),
          hrv: Math.round(45 + Math.random() * 20 - (i === 0 ? 8 : 0)),
          schlaf: { gesamt: round1(g), tief: round1(g * 0.12), rem: round1(g * 0.24), kern: round1(g * 0.62), wach: 0.1, start: '01:12', ende: '06:58' },
        };
      }
      localStorage.setItem(HKEY, JSON.stringify(health));
    },
    clear() { localStorage.removeItem(KEY); localStorage.removeItem(HKEY); },
  };
}

function round1(x) { return Math.round(x * 10) / 10; }
function toKey(dt) {
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
