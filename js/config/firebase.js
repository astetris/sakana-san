import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth, signInAnonymously, onAuthStateChanged,
  GoogleAuthProvider, EmailAuthProvider,
  linkWithPopup, linkWithCredential,
  signInWithPopup, signInWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { getDatabase, ref, set, get, remove, push, onValue, onDisconnect, query, limitToLast, runTransaction } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";

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
export function isFirebaseReady() { return ready; }

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
  try { await setDoc(doc(db, "users", currentUid), { slots: slotsData, updatedAt: Date.now() }, { merge: true }); }
  catch (e) { console.warn("クラウド保存スキップ:", e); }
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

// ===== 5部門の日替わりランキング =====
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
    const normalized = list.map((x) => ({
      uid: x.uid, name: x.name,
      score: typeof x.score === "number" ? x.score : (x.weightKg || 0),
      detail: x.detail || x.fishName || "", updatedAt: x.updatedAt || 0
    }));
    const existingIdx = normalized.findIndex((x) => x.uid === currentUid);
    if (existingIdx >= 0 && normalized[existingIdx].score >= score) return;

    const entry = { uid: currentUid, name: playerName, score: Number(Number(score).toFixed(2)), detail, updatedAt: Date.now() };
    if (existingIdx >= 0) normalized[existingIdx] = entry;
    else normalized.push(entry);
    normalized.sort((a, b) => b.score - a.score);
    await setDoc(boardRef, { topList: normalized.slice(0, 20), updatedAt: Date.now() });
  } catch (e) { console.warn("ランキング更新スキップ:", e); }
}

export async function resetTodayDailyRankings() {
  if (!ready) return { ok: false, msg: "Firebase未接続のためリセットできません。" };
  try {
    const dateKey = getJstDateKey();
    await Promise.all(
      RANKING_BOARDS.map((b) =>
        setDoc(doc(db, "daily_rankings", dateKey, "boards", b.id), {
          topList: [],
          updatedAt: Date.now()
        })
      )
    );
    return { ok: true, msg: `本日（${dateKey}）の全${RANKING_BOARDS.length}部門ランキングをリセットしました！` };
  } catch (e) {
    return { ok: false, msg: e?.message || "ランキングのリセットに失敗しました。" };
  }
}

// ===== リアルタイムワールド同期 =====
export async function updateWorldPresence(payload) {
  if (!ready || !currentUid) return;
  try {
    if (!worldPlayerRef) {
      worldPlayerRef = ref(rtdb, `world_players/${currentUid}`);
      onDisconnect(worldPlayerRef).remove();
    }
    await set(worldPlayerRef, { ...payload, ts: Date.now() });
  } catch (e) {}
}

export async function clearWorldPresence() {
  if (!ready || !worldPlayerRef) return;
  try { await remove(worldPlayerRef); } catch (e) {}
}

export function subscribeWorldPlayers(callback) {
  if (!ready) return () => {};
  return onValue(ref(rtdb, "world_players"), (snap) => {
    const val = snap.val() || {}, now = Date.now(), others = {};
    for (const [uid, p] of Object.entries(val)) {
      if (uid === currentUid) continue;
      if (!p || now - (p.ts || 0) > 45000) continue;
      others[uid] = p;
    }
    callback(others);
  });
}

// ===== ライブ速報 =====
export async function pushWorldFeed({ text, kind = "catch" }) {
  if (!ready || !currentUid) return;
  try { await push(ref(rtdb, "world_feed"), { uid: currentUid, text, kind, ts: Date.now() }); } catch (e) {}
}

export function subscribeWorldFeed(callback) {
  if (!ready) return () => {};
  return onValue(query(ref(rtdb, "world_feed"), limitToLast(10)), (snap) => {
    const val = snap.val(); if (!val) return;
    const list = Object.values(val).sort((a, b) => (a.ts || 0) - (b.ts || 0));
    if (list.length) callback(list[list.length - 1]);
  });
}

// ===== Phase 6: 公開プロフィール =====
export async function publishMyProfile(profilePayload) {
  if (!ready || !currentUid) return;
  try {
    await set(ref(rtdb, `profiles/${currentUid}`), {
      ...profilePayload,
      uid: currentUid,
      updatedAt: Date.now()
    });
  } catch (e) { console.warn("プロフ公開スキップ:", e); }
}

export async function fetchPublicProfile(uid) {
  if (!ready || !uid) return null;
  try {
    const snap = await get(ref(rtdb, `profiles/${uid}`));
    return snap.exists() ? snap.val() : null;
  } catch (e) { return null; }
}

// ===== Phase 6: リアルタイムチャット（global / lounge） =====
export async function sendChatMessage(room, { name, title, text }) {
  if (!ready || !currentUid || !text.trim()) return false;
  try {
    await push(ref(rtdb, `chat/${room}`), {
      uid: currentUid,
      name: (name || "漁師").slice(0, 14),
      title: (title || "").slice(0, 16),
      text: text.trim().slice(0, 140),
      ts: Date.now()
    });
    return true;
  } catch (e) {
    console.warn("チャット送信エラー:", e);
    return false;
  }
}

export function subscribeChatRoom(room, callback) {
  if (!ready) return () => {};
  return onValue(query(ref(rtdb, `chat/${room}`), limitToLast(35)), (snap) => {
    const val = snap.val() || {};
    const list = Object.values(val).sort((a, b) => (a.ts || 0) - (b.ts || 0));
    callback(list);
  });
}

// ===== Phase 6: フレンド申請・承認・一覧 =====
export async function sendFriendRequest(targetUid, myInfo) {
  if (!ready || !currentUid || !targetUid || targetUid === currentUid) return false;
  try {
    await set(ref(rtdb, `friend_requests/${targetUid}/${currentUid}`), {
      uid: currentUid,
      name: myInfo.name || "漁師",
      title: myInfo.title || "見習い漁師",
      ts: Date.now()
    });
    return true;
  } catch (e) { return false; }
}

export async function acceptFriendRequest(fromUid, fromInfo, myInfo) {
  if (!ready || !currentUid || !fromUid) return false;
  try {
    const now = Date.now();
    await set(ref(rtdb, `friends/${currentUid}/${fromUid}`), { uid: fromUid, name: fromInfo.name || "漁師", since: now });
    await set(ref(rtdb, `friends/${fromUid}/${currentUid}`), { uid: currentUid, name: myInfo.name || "漁師", since: now });
    await remove(ref(rtdb, `friend_requests/${currentUid}/${fromUid}`));
    return true;
  } catch (e) { return false; }
}

export async function rejectFriendRequest(fromUid) {
  if (!ready || !currentUid || !fromUid) return;
  try { await remove(ref(rtdb, `friend_requests/${currentUid}/${fromUid}`)); } catch (e) {}
}

export async function removeFriend(otherUid) {
  if (!ready || !currentUid || !otherUid) return;
  try {
    await remove(ref(rtdb, `friends/${currentUid}/${otherUid}`));
    await remove(ref(rtdb, `friends/${otherUid}/${currentUid}`));
  } catch (e) {}
}

export function subscribeFriends(callback) {
  if (!ready || !currentUid) return () => {};
  return onValue(ref(rtdb, `friends/${currentUid}`), (snap) => callback(snap.val() || {}));
}

export function subscribeFriendRequests(callback) {
  if (!ready || !currentUid) return () => {};
  return onValue(ref(rtdb, `friend_requests/${currentUid}`), (snap) => callback(snap.val() || {}));
}

// ===== Phase 6: 真珠＆月額パス引換コード（管理人発行→ユーザー引換） =====
export async function createRedeemCode(code, payload) {
  if (!ready) return false;
  try {
    const clean = code.trim().toUpperCase();
    await set(ref(rtdb, `redeem_codes/${clean}`), {
      ...payload,
      used: false,
      createdAt: Date.now()
    });
    return true;
  } catch (e) { return false; }
}

export async function consumeRedeemCode(code) {
  if (!ready || !currentUid) return { ok: false, msg: "オンライン接続が必要です" };
  try {
    const clean = code.trim().toUpperCase();
    if (!clean) return { ok: false, msg: "コードを入力してください" };
    const codeRef = ref(rtdb, `redeem_codes/${clean}`);
    const snap = await get(codeRef);
    if (!snap.exists()) return { ok: false, msg: "無効なコードです" };
    const data = snap.val();
    if (data.used) return { ok: false, msg: "このコードはすでに使用済みです" };
    await set(codeRef, { ...data, used: true, usedBy: currentUid, usedAt: Date.now() });
    return { ok: true, data };
  } catch (e) {
    return { ok: false, msg: "コード確認に失敗しました（RTDBルールを確認）" };
  }
}


// ===== Phase 7: 1人1回・人数制クーポン（割引＆真珠/パス配布） =====
export async function createCouponCode(code, payload) {
  if (!ready) return false;
  try {
    const clean = code.trim().toUpperCase();
    await set(ref(rtdb, `coupons/${clean}`), {
      ...payload,
      maxUses: Math.max(1, payload.maxUses || 1),
      usedCount: 0,
      usedBy: {},
      createdAt: Date.now()
    });
    return true;
  } catch (e) { console.warn("クーポン発行エラー:", e); return false; }
}

export async function previewCouponCode(code) {
  if (!ready || !currentUid) return { ok: false, msg: "オンライン接続が必要です" };
  try {
    const clean = code.trim().toUpperCase();
    const snap = await get(ref(rtdb, `coupons/${clean}`));
    if (!snap.exists()) return { ok: false, msg: "無効なコードです" };
    const d = snap.val();
    if (d.usedBy && d.usedBy[currentUid]) return { ok: false, msg: "このコードはすでに使用済みです（1人1回限り）" };
    if ((d.usedCount || 0) >= (d.maxUses || 1)) return { ok: false, msg: "このコードは利用上限人数に達しました" };
    return { ok: true, data: d };
  } catch (e) { return { ok: false, msg: "コード確認に失敗しました（RTDBルール確認）" }; }
}

export async function redeemCouponCode(code) {
  const pre = await previewCouponCode(code);
  if (!pre.ok) return pre;
  try {
    const clean = code.trim().toUpperCase();
    const codeRef = ref(rtdb, `coupons/${clean}`);
    let rejectReason = "使用できませんでした";
    const tx = await runTransaction(codeRef, (cur) => {
      if (!cur) return cur;
      const usedBy = cur.usedBy || {};
      if (usedBy[currentUid]) { rejectReason = "このコードはすでに使用済みです（1人1回限り）"; return; }
      if ((cur.usedCount || 0) >= (cur.maxUses || 1)) { rejectReason = "利用上限人数に達しました"; return; }
      usedBy[currentUid] = Date.now();
      return { ...cur, usedCount: (cur.usedCount || 0) + 1, usedBy };
    });
    if (!tx.committed) return { ok: false, msg: rejectReason };
    return { ok: true, data: tx.snapshot.val() };
  } catch (e) { return { ok: false, msg: "コード引換に失敗しました" }; }
}

// ===== Phase 8: Stripe 自動決済（未受取購入の監視・削除） =====
export function subscribePendingPurchases(callback) {
  if (!ready || !currentUid) return () => {};
  return onValue(ref(rtdb, `pending_purchases/${currentUid}`), (snap) => {
    callback(snap.val() || {});
  });
}

export async function clearPendingPurchase(sessionId) {
  if (!ready || !currentUid || !sessionId) return false;
  try {
    await remove(ref(rtdb, `pending_purchases/${currentUid}/${sessionId}`));
    return true;
  } catch (e) {
    console.warn("購入データの削除に失敗:", e);
    return false;
  }
}

// ===== Phase 8: 複数アカウント連携（Google / メール＆パスワード） =====
export function getAuthAccountSummary() {
  const u = auth?.currentUser;
  if (!u) return { signedIn: false, isAnonymous: true, uid: null, providers: [], email: "" };
  const providers = (u.providerData || []).map((p) => p.providerId).filter(Boolean);
  return {
    signedIn: true,
    isAnonymous: !!u.isAnonymous,
    uid: u.uid,
    providers,
    email: u.email || ""
  };
}

function formatAuthError(e) {
  const code = e?.code || "";
  if (code === "auth/credential-already-in-use" || code === "auth/email-already-in-use") {
    return "そのアカウントはすでに別のセーブデータに紐づいています。「既存アカウントでサインイン」をお試しください。";
  }
  if (code === "auth/invalid-email") return "メールアドレスの形式が正しくありません。";
  if (code === "auth/weak-password") return "パスワードは6文字以上で入力してください。";
  if (code === "auth/wrong-password" || code === "auth/invalid-credential") {
    return "メールアドレスまたはパスワードが正しくありません。";
  }
  if (code === "auth/user-not-found") return "該当するアカウントが見つかりません。";
  if (code === "auth/popup-closed-by-user") return "ログイン画面が閉じられました。";
  return e?.message || "認証処理に失敗しました。";
}

export async function linkOrSignInGoogle(mode = "link") {
  if (!auth?.currentUser) return { ok: false, msg: "認証機能が初期化されていません。" };
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  try {
    let cred;
    if (mode === "signin") {
      cred = await signInWithPopup(auth, provider);
    } else if (auth.currentUser.isAnonymous) {
      cred = await linkWithPopup(auth.currentUser, provider);
    } else {
      cred = await signInWithPopup(auth, provider);
    }
    currentUid = cred.user.uid;
    return {
      ok: true,
      uid: currentUid,
      msg: mode === "signin" ? "Googleアカウントへサインインしました！" : "Googleアカウントと連携しました！"
    };
  } catch (e) {
    if (e?.code === "auth/provider-already-linked") {
      return { ok: true, uid: auth.currentUser.uid, msg: "すでにGoogleアカウントと連携済みです。" };
    }
    return { ok: false, msg: formatAuthError(e) };
  }
}

export async function linkOrSignInEmail({ email, password, mode = "link" }) {
  if (!auth?.currentUser) return { ok: false, msg: "認証機能が初期化されていません。" };
  const cleanEmail = (email || "").trim();
  if (!cleanEmail || !password) return { ok: false, msg: "メールアドレスとパスワードを入力してください。" };
  try {
    let cred;
    if (mode === "signin") {
      cred = await signInWithEmailAndPassword(auth, cleanEmail, password);
    } else {
      const credential = EmailAuthProvider.credential(cleanEmail, password);
      if (auth.currentUser.isAnonymous) {
        cred = await linkWithCredential(auth.currentUser, credential);
      } else {
        cred = await signInWithEmailAndPassword(auth, cleanEmail, password);
      }
    }
    currentUid = cred.user.uid;
    return { ok: true, uid: currentUid, msg: mode === "signin" ? "アカウントへサインインしました！" : "メール＆パスワードと連携しました！" };
  } catch (e) {
    if (e?.code === "auth/provider-already-linked") {
      return { ok: true, uid: auth.currentUser.uid, msg: "すでにメール＆パスワードと連携済みです。" };
    }
    return { ok: false, msg: formatAuthError(e) };
  }
}

// ===== プレイヤー名の一意ロック（既に使われている名前は使用不可） =====
export function normalizePlayerNameKey(rawName) {
  const clean = String(rawName || "").trim().replace(/\s+/g, " ");
  if (!clean) return "";
  return clean
    .toLowerCase()
    .replace(/[.#$\[\]\/\\]/g, (ch) => "_" + ch.charCodeAt(0).toString(16) + "_");
}

export async function claimPlayerName(newName, prevName = "") {
  const clean = String(newName || "").trim().replace(/\s+/g, " ");
  if (!clean || clean.length < 1 || clean.length > 12) {
    return { ok: false, reason: "名前は1〜12文字で入力してください。" };
  }
  const key = normalizePlayerNameKey(clean);
  if (!key) return { ok: false, reason: "使用できない文字のみの名前です。" };
  if (!ready || !rtdb || !currentUid) {
    return { ok: true, name: clean, offline: true };
  }
  try {
    const nameRef = ref(rtdb, `playerNames/${key}`);
    const tx = await runTransaction(nameRef, (cur) => {
      if (cur === null || (cur && cur.uid === currentUid)) {
        return { uid: currentUid, name: clean, updatedAt: Date.now() };
      }
      return; // 他プレイヤーが使用中なので中断
    });
    const val = tx.snapshot?.val();
    if (!tx.committed || !val || val.uid !== currentUid) {
      return { ok: false, reason: `「${clean}」はすでに他のプレイヤーが使用しています。別の名前にしてください。` };
    }
    const prevKey = normalizePlayerNameKey(prevName);
    if (prevKey && prevKey !== key) {
      const prevRef = ref(rtdb, `playerNames/${prevKey}`);
      const prevSnap = await get(prevRef);
      if (prevSnap.exists() && prevSnap.val()?.uid === currentUid) {
        await remove(prevRef).catch(() => {});
      }
    }
    return { ok: true, name: clean };
  } catch (e) {
    console.warn("claimPlayerName error:", e);
    return { ok: true, name: clean, offline: true };
  }
}
