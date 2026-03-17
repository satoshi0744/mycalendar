/**
 * MyCalendar - Google OAuth認証モジュール
 * 
 * Google Identity Services (GIS) を使用してOAuth 2.0認証を行う。
 * Calendar API (読み書き) と Drive API (読取専用) のスコープを
 * 1つのトークンで同時に取得する。
 * 
 * トークンはsessionStorageに保持し、タブを閉じたら自動的に破棄される。
 * ユーザーのメールアドレスをlocalStorageに保存し、次回以降のログインで
 * アカウント選択をスキップする（login_hint）。
 */

import type { AuthState } from '../data/types';

// Google API スコープ
const SCOPES = [
  'https://www.googleapis.com/auth/calendar',        // カレンダー読み書き
  'https://www.googleapis.com/auth/drive.readonly',   // ドライブ読取専用
].join(' ');

// ストレージキー
const STORAGE_KEY_TOKEN = '__mycal_token';
const STORAGE_KEY_EXPIRES = '__mycal_expires';
const STORAGE_KEY_USER = '__mycal_user';
const STORAGE_KEY_HINT = '__mycal_login_hint'; // localStorage: アカウント記憶

// --- Google Identity Services 型定義 ---
interface TokenResponse {
  access_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
  error?: string;
}

interface TokenClient {
  requestAccessToken: (overrideConfig?: { prompt?: string; hint?: string; login_hint?: string }) => void;
  callback: (response: TokenResponse) => void;
}

declare const google: {
  accounts: {
    oauth2: {
      initTokenClient: (config: {
        client_id: string;
        scope: string;
        callback: (response: TokenResponse) => void;
        hint?: string;
        login_hint?: string;
      }) => TokenClient;
      revoke: (token: string, callback?: () => void) => void;
    };
  };
};

// --- 状態 ---
let accessToken: string | null = null;
let tokenClient: TokenClient | null = null;
let tokenExpiresAt: number = 0;
let authStateListeners: Array<(state: AuthState) => void> = [];
let userInfo: { name: string | null; email: string | null } = { name: null, email: null };

// --- ロックと再認証状態の管理 ---
let refreshPromise: Promise<boolean> | null = null;
let refreshResolver: ((success: boolean) => void) | null = null;

function clearRefreshState(): void {
  refreshPromise = null;
  refreshResolver = null;
}

/**
 * sessionStorageからトークンを復元する。
 */
function restoreSession(): void {
  try {
    const storedToken = localStorage.getItem(STORAGE_KEY_TOKEN);
    const storedExpires = localStorage.getItem(STORAGE_KEY_EXPIRES);
    const storedUser = localStorage.getItem(STORAGE_KEY_USER);

    if (storedToken && storedExpires) {
      const expires = parseInt(storedExpires, 10);
      if (Date.now() < expires) {
        accessToken = storedToken;
        tokenExpiresAt = expires;
        if (storedUser) {
          try { userInfo = JSON.parse(storedUser); } catch { /* ignore */ }
        }
      } else {
        // 期限切れ → ユーザー情報は保持しつつトークンだけクリア
        // silentRefreshで自動再取得を試みる
        accessToken = null;
        tokenExpiresAt = 0;
        if (storedUser) {
          try { userInfo = JSON.parse(storedUser); } catch { /* ignore */ }
        }
      }
    }
  } catch {
    // localStorageが使えない環境は無視
  }
}

/**
 * localStorageにトークンを保存する。
 */
function saveSession(): void {
  try {
    if (accessToken) {
      localStorage.setItem(STORAGE_KEY_TOKEN, accessToken);
      localStorage.setItem(STORAGE_KEY_EXPIRES, String(tokenExpiresAt));
      localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(userInfo));
    }
  } catch {
    // ignore
  }
}

/**
 * sessionStorageからトークンを削除する。
 */
function clearSession(): void {
  try {
    localStorage.removeItem(STORAGE_KEY_TOKEN);
    localStorage.removeItem(STORAGE_KEY_EXPIRES);
    localStorage.removeItem(STORAGE_KEY_USER);
  } catch {
    // ignore
  }
}

/**
 * 保存されたlogin_hintを取得する。
 */
export function getSavedLoginHint(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY_HINT);
  } catch {
    return null;
  }
}

/**
 * login_hintを保存する。
 */
function saveLoginHint(email: string): void {
  try {
    localStorage.setItem(STORAGE_KEY_HINT, email);
  } catch {
    // ignore
  }
}

// ページ読み込み時にセッションを復元
restoreSession();

/**
 * 認証モジュールを初期化する。
 * トークンが復元済みならリスナーに通知。期限切れなら自動再認証を試みる。
 * 
 * @param clientId Google Cloud Console で取得した OAuth 2.0 クライアントID
 */
export function initAuth(clientId: string): void {

  const hint = getSavedLoginHint();

  // Google SDKがロードされていない（オフラインなど）場合は初期化できない
  if (typeof google === 'undefined' || !google.accounts || !google.accounts.oauth2) {
    console.warn('Google Identity Services SDK not loaded (offline?).');
    return;
  }

  // Google SDKがロードされていない（オフラインなど）場合は初期化できない
  if (typeof google === 'undefined' || !google.accounts || !google.accounts.oauth2) {
    console.warn('Google Identity Services SDK not loaded (offline?).');
    return;
  }

  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: SCOPES,
    callback: handleTokenResponse,
    ...(hint ? { hint, login_hint: hint } : {}),
  });

  // セッションが復元されている場合はリスナーに通知
  if (isAuthenticated()) {
    notifyListeners();
  } else if (hint) {
    // トークン期限切れだがlogin_hintがある → バックグラウンドで自動再認証
    // これによりログイン画面をスキップできる
    silentRefresh().catch(() => {});
  }
}

/**
 * ログインを開始する（ポップアップが表示される）。
 * 保存されたアカウントがあればアカウント選択をスキップする。
 */
export function signIn(): void {
  // 未初期化の場合はその場で初期化を試みる
  if (!tokenClient) {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (clientId) {
      initAuth(clientId);
    } else {
      console.error('Auth not initialized. Cannot sign in.');
      return;
    }
  }

  const hint = getSavedLoginHint();
  // prompt '' + login_hint でアカウント選択をスキップ
  tokenClient!.requestAccessToken({
    prompt: '',
    ...(hint ? { login_hint: hint } : {}),
  });
}

/**
 * トークンの期限切れ時にバックグラウンドで再取得する。
 * ユーザーには何も表示されない（同意済みの場合）。
 * 失敗時（ITP等でブロック時）は即座にログアウト状態に遷移する。
 * @returns 成功したかどうかを示すPromise
 */
export function silentRefresh(): Promise<boolean> {
  if (refreshPromise) {
    // すでにリフレッシュ中なら、その完了を待つ（競合防止）
    return refreshPromise;
  }

  if (!tokenClient) {
    console.warn('silentRefresh: tokenClient not initialized. Attempting initialization...');
    // まだ初期化されていない場合は、保存されたクライアントIDがあれば初期化を試みる
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (clientId) {
      initAuth(clientId);
      if (refreshPromise) return refreshPromise; // initAuth内で発火した場合はそれを返す
    }
    return Promise.resolve(false);
  }

  const hint = getSavedLoginHint();
  
  refreshPromise = new Promise<boolean>((resolve) => {
    refreshResolver = resolve;

    // 10秒経ってもコールバックが来ない場合のフェイルセーフ
    const timeout = setTimeout(() => {
      console.warn('silentRefresh: callback timeout');
      if (refreshResolver) {
        refreshResolver(false);
        clearRefreshState();
      }
    }, 10000);

    const origResolver = refreshResolver;
    refreshResolver = (success: boolean) => {
      clearTimeout(timeout);
      origResolver(success);
      clearRefreshState();
    };

    // prompt: 'none' でバックグラウンド取得を強制（失敗時は即エラーが返る）
    try {
      console.log('Attempting silent refresh for:', hint);
      tokenClient!.requestAccessToken({
        prompt: 'none',
        ...(hint ? { login_hint: hint } : {}),
      });
    } catch (e) {
      console.error('silentRefresh: request error', e);
      if (refreshResolver) refreshResolver(false);
    }
  });

  return refreshPromise;
}

/**
 * ログアウトする（トークンを破棄）。
 */
export function signOut(): void {
  if (accessToken && typeof google !== 'undefined' && google.accounts?.oauth2) {
    google.accounts.oauth2.revoke(accessToken);
  }
  accessToken = null;
  tokenExpiresAt = 0;
  userInfo = { name: null, email: null };
  clearSession();
  // login_hintは残す（次回ログイン時に使う）
  notifyListeners();
}

/**
 * 現在のアクセストークンを取得する。
 * 期限切れの場合はnullを返す。
 */
export function getAccessToken(): string | null {
  if (accessToken && Date.now() < tokenExpiresAt) {
    return accessToken;
  }
  return null;
}

/**
 * 認証済みかどうかを返す。
 */
export function isAuthenticated(): boolean {
  return getAccessToken() !== null;
}

/**
 * 認証状態の変更を監視する。
 */
export function onAuthStateChange(listener: (state: AuthState) => void): () => void {
  authStateListeners.push(listener);
  return () => {
    authStateListeners = authStateListeners.filter(l => l !== listener);
  };
}

/**
 * 現在の認証状態を取得する。
 */
export function getAuthState(): AuthState {
  return {
    isSignedIn: isAuthenticated(),
    accessToken: getAccessToken(),
    userName: userInfo.name,
    userEmail: userInfo.email,
  };
}

// --- 内部関数 ---

function handleTokenResponse(response: TokenResponse): void {
  if (response.error) {
    console.error('Token error:', response.error);
    if (refreshResolver) refreshResolver(false);
    return;
  }
  
  if (refreshResolver) refreshResolver(true);

  accessToken = response.access_token;
  tokenExpiresAt = Date.now() + response.expires_in * 1000;
  
  // 期限切れ前に自動更新をスケジュール（5分前）
  const refreshIn = (response.expires_in - 300) * 1000;
  if (refreshIn > 0) {
    setTimeout(() => {
      silentRefresh();
    }, refreshIn);
  }

  // ユーザー情報を取得 → 保存 → リスナーに通知
  fetchUserInfo(response.access_token).then(() => {
    saveSession();
    notifyListeners();
  });
}

async function fetchUserInfo(token: string): Promise<void> {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const info = await res.json();
      userInfo = {
        name: info.name || null,
        email: info.email || null,
      };
      // login_hintとして保存（次回ログイン時にアカウント選択スキップ）
      if (info.email) {
        saveLoginHint(info.email);
      }
    }
  } catch {
    // ユーザー情報取得は必須ではない
  }
}

function notifyListeners(): void {
  const state: AuthState = {
    isSignedIn: isAuthenticated(),
    accessToken: getAccessToken(),
    userName: userInfo.name,
    userEmail: userInfo.email,
  };
  for (const listener of authStateListeners) {
    listener(state);
  }
}
