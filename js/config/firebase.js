import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import {
  getDatabase, ref, set, remove, push, onValue, onDisconnect, query, limitToLast
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";

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

export const RANKING_BOARDS = [
  { id: "biggest_weight", label: "🐟 大物重量", unit: "kg", format: (v) => `${Number(v).toFixed(2)}kg` },
  { id: "highest_price",  label: "💰 1匹最高額", unit: "円", format: (v) => `¥${Math.round(v).toLocaleString()}` },
  { id: "daily_count",    label: "🔢 今日の匹数", unit: "匹", format: (v) => `${Math.round(v)}匹` },
  { id: "biggest_shell",  label: "🐚 貝マスター", unit: "kg", format: (v) => `${Number(v).toFixed(2)}kg` },
  { id: "daily_earned",   label: "🏪 売上王",     unit: "円", format: (v) => `¥${Math.round(v).toLocaleString()}` }
];

let app, auth, db, rtdb;
let currentUid = null;
let ready = false;
let worldPlayerRef = null;

export function getCurrentUid() { return currentUid; }

export async function initFirebase({ onOnlineCount, onStatus }) {
  try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    rtdb = getDatabase(app);

    await new Promise((resolve) => {
      onAuthStateChanged(auth, async (user) => {
        if (user) { currentUid = user.uid; resolve(); }
        else {
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

// ===== 5部門の日替わりランキング（Firestore） =====
export async function fetchDailyRanking(boardId = "biggest_weight") {
  if (!ready) return [];
  try {
    const dateKey = getJstDateKey();
    const snap = await getDoc(doc(db, "daily_rankings", dateKey, "boards", boardId));
    return snap.exists() ? (snap.data().topList || []) : [];
  } catch (e) { return []; }
}

export async function submitDailyBoard(boardId, { playerName, score, detail = "" }) {
  if (!ready || !currentUid || !score || score <= 0) return;
  try {
    const dateKey = getJstDateKey();
    const boardRef = doc(db, "daily_rankings", dateKey, "boards", boardId);
    const snap = await getDoc(boardRef);
    const list = snap.exists() ? (snap.data().topList || []) : [];

    // 既存データ互換（旧PhaseのweightKgをscoreとして読む）
    const normalized = list.map((x) => ({
      uid: x.uid,
      name: x.name,
      score: typeof x.score === "number" ? x.score : (x.weightKg || 0),
      detail: x.detail || x.fishName || "",
      updatedAt: x.updatedAt || 0
    }));

    const existingIdx = normalized.findIndex((x) => x.uid === currentUid);
    if (existingIdx >= 0 && normalized[existingIdx].score >= score) return;

    const entry = {
      uid: currentUid,
      name: playerName,
      score: Number(Number(score).toFixed(2)),
      detail,
      updatedAt: Date.now()
    };

    if (existingIdx >= 0) normalized[existingIdx] = entry;
    else normalized.push(entry);

    normalized.sort((a, b) => b.score - a.score);
    await setDoc(boardRef, { topList: normalized.slice(0, 20), updatedAt: Date.now() });
  } catch (e) { console.warn("ランキング更新スキップ:", e); }
}

// ===== リアルタイム「同じ海で一緒に釣り」同期（Realtime Database） =====
export async function updateWorldPresence(payload) {
  if (!ready || !currentUid) return;
  try {
    if (!worldPlayerRef) {
      worldPlayerRef = ref(rtdb, `world_players/${currentUid}`);
      onDisconnect(worldPlayerRef).remove();
    }
    await set(worldPlayerRef, { ...payload, ts: Date.now() });
  } catch (e) { /* ignore transient network error */ }
}

export async function clearWorldPresence() {
  if (!ready || !worldPlayerRef) return;
  try { await remove(worldPlayerRef); } catch (e) { /* ignore */ }
}

export function subscribeWorldPlayers(callback) {
  if (!ready) return () => {};
  const playersRef = ref(rtdb, "world_players");
  return onValue(playersRef, (snap) => {
    const val = snap.val() || {};
    const now = Date.now();
    const others = {};
    for (const [uid, p] of Object.entries(val)) {
      if (uid === currentUid) continue;
      if (!p || now - (p.ts || 0) > 45000) continue; // 45秒以上更新がないゴーストは除外
      others[uid] = p;
    }
    callback(others);
  });
}

// ===== ライブ釣果速報 ＆ スタンプフィード =====
export async function pushWorldFeed({ text, kind = "catch" }) {
  if (!ready || !currentUid) return;
  try {
    await push(ref(rtdb, "world_feed"), {
      uid: currentUid,
      text,
      kind,
      ts: Date.now()
    });
  } catch (e) { /* ignore */ }
}

export function subscribeWorldFeed(callback) {
  if (!ready) return () => {};
  const feedQuery = query(ref(rtdb, "world_feed"), limitToLast(10));
  return onValue(feedQuery, (snap) => {
    const val = snap.val();
    if (!val) return;
    const list = Object.values(val).sort((a, b) => (a.ts || 0) - (b.ts || 0));
    const latest = list[list.length - 1];
    if (latest) callback(latest);
  });
}
