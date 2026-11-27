import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { getDatabase, ref, set, onValue, onDisconnect } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyCuAOvVHpUrbUGnHVtyr03jscRbJkqlvFc",
  authDomain: "sakana-san-45cb8.firebaseapp.com",
  databaseURL: "https://sakana-san-45cb8-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "sakana-san-45cb8",
  storageBucket: "sakana-san-45cb8.firebasestorage.app",
  messagingSenderId: "135266367746",
  appId: "1:135266367746:web:4c07be81991646c5e5ea1b",
  measurementId: "G-ZEPTSX6YM7"
};

let app, auth, db, rtdb;
let currentUid = null;
let ready = false;

export async function initFirebase({ onOnlineCount, onStatus }) {
  try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    rtdb = getDatabase(app);

    await new Promise((resolve) => {
      onAuthStateChanged(auth, async (user) => {
        if (user) {
          currentUid = user.uid;
          resolve();
        } else {
          try {
            const cred = await signInAnonymously(auth);
            currentUid = cred.user.uid;
          } catch (e) { console.warn("匿名ログイン失敗:", e); }
          resolve();
        }
      });
    });

    if (currentUid) {
      ready = true;
      onStatus?.("クラウド同期OK");
      const myOnlineRef = ref(rtdb, `online/${currentUid}`);
      onDisconnect(myOnlineRef).remove();
      await set(myOnlineRef, { ts: Date.now() });

      onValue(ref(rtdb, "online"), (snap) => {
        const val = snap.val();
        onOnlineCount?.(val ? Object.keys(val).length : 1);
      });
    } else {
      onStatus?.("オフラインモード");
      onOnlineCount?.(1);
    }
  } catch (e) {
    console.warn("Firebase初期化フォールバック:", e);
    onStatus?.("ローカル保存モード");
    onOnlineCount?.(1);
  }
  return { ready, uid: currentUid };
}

export async function saveCloudSlots(slotsData) {
  if (!ready || !currentUid) return;
  try {
    await setDoc(doc(db, "users", currentUid), { slots: slotsData, updatedAt: Date.now() }, { merge: true });
  } catch (e) { console.warn("クラウド保存スキップ:", e); }
}

export async function loadCloudSlots() {
  if (!ready || !currentUid) return null;
  try {
    const snap = await getDoc(doc(db, "users", currentUid));
    return snap.exists() ? (snap.data().slots || null) : null;
  } catch (e) { return null; }
}

export function getJstDateKey() {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  if (jst.getUTCHours() < 5) jst.setUTCDate(jst.getUTCDate() - 1);
  return jst.toISOString().slice(0, 10);
}

export async function fetchDailyRanking() {
  if (!ready) return [];
  try {
    const dateKey = getJstDateKey();
    const snap = await getDoc(doc(db, "daily_rankings", dateKey, "boards", "biggest_weight"));
    return snap.exists() ? (snap.data().topList || []) : [];
  } catch (e) { return []; }
}

export async function submitDailyRecord({ playerName, fishName, weightKg, rank, condition }) {
  if (!ready || !currentUid) return;
  try {
    const dateKey = getJstDateKey();
    const boardRef = doc(db, "daily_rankings", dateKey, "boards", "biggest_weight");
    const snap = await getDoc(boardRef);
    const list = snap.exists() ? (snap.data().topList || []) : [];
    const existingIdx = list.findIndex((x) => x.uid === currentUid);
    if (existingIdx >= 0 && list[existingIdx].weightKg >= weightKg) return;

    const entry = {
      uid: currentUid, name: playerName, fishName,
      weightKg: Number(weightKg.toFixed(2)), rank, condition: condition || "", updatedAt: Date.now()
    };
    if (existingIdx >= 0) list[existingIdx] = entry;
    else list.push(entry);

    list.sort((a, b) => b.weightKg - a.weightKg);
    await setDoc(boardRef, { topList: list.slice(0, 20), updatedAt: Date.now() });
  } catch (e) { console.warn("ランキング更新スキップ:", e); }
}
