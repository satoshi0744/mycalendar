import { useState, useEffect, useRef } from 'react';
import type { AuthState, AppEvent } from './data/types';
import { initAuth, signIn, signOut, onAuthStateChange, getAuthState, getSavedLoginHint, silentRefresh } from './auth/GoogleAuth';
import { useCalendarData } from './hooks/useCalendarData';
import YearView from './components/YearView';
import MonthView from './components/MonthView';
import WeekView from './components/WeekView';
import DayView from './components/DayView';
import ViewSwitcher from './components/ViewSwitcher';
import CalendarList from './components/CalendarList';
import EventForm from './components/EventForm';
import SearchOverlay from './components/SearchOverlay';
import { ReconnectButton } from './components/ReconnectButton';
import { useNetworkStatus } from './hooks/useNetworkStatus';
import './App.css';

// Google Cloud Console で取得したクライアントID
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

function App() {
  const [authState, setAuthState] = useState<AuthState>(getAuthState());
  const [authLoading, setAuthLoading] = useState(true); // 認証復元中のローディング
  const isOnline = useNetworkStatus(); // ネットワーク接続状態の監視
  const [sidebarOpen, setSidebarOpen] = useState(() => typeof window !== 'undefined' && window.innerWidth > 768); // サイドバー開閉（PCではデフォルト開く）
  const [showSearch, setShowSearch] = useState(false);
  const [showEventForm, setShowEventForm] = useState(false);
  const [editingEvent, setEditingEvent] = useState<AppEvent | null>(null);
  const [eventFormDate, setEventFormDate] = useState<Date | undefined>(undefined);

  const {
    events,
    calendars,
    loading,
    currentDate,
    viewMode,
    defaultCalendarId,
    setCurrentDate,
    setViewMode,
    toggleCalendarVisibility,
    setDefaultCalendar,
    refresh,
    syncYearData,
    syncing,
    error,
    lastSyncTime,
  } = useCalendarData();

  useEffect(() => {
    if (CLIENT_ID) {
      initAuth(CLIENT_ID);
    }
    const unsubscribe = onAuthStateChange((state) => {
      setAuthState(state);
      setAuthLoading(false);
      // initAuth内で完了した初回の状態変更時のみデータを取得する
      if (state.isSignedIn && !loading) {
        refresh(); // 直近データを取得
        syncYearData(false).catch(() => {}); // 起動時は24時間ルールで同期（自動）
      }
    });

    // 5秒経っても認証状態が来なければタイムアウトだが、以前のアカウントがあればスキップしない
    const timeout = setTimeout(() => {
      setAuthLoading(false);
    }, 5000);

    const handleResume = () => {
      if (document.visibilityState === 'visible') {
        const state = getAuthState();
        const hint = getSavedLoginHint();
        // ログイン済みならバックグラウンドで予定を最新化する。
        if (state.isSignedIn) {
          refresh();
        } else if (hint && !loading) {
          // 未ログインだがヒントがある場合、バックグラウンドで自動再ログインを試みる
          console.log('App: Resumed and attempting silent re-auth for:', hint);
          silentRefresh().then(success => {
            if (success) refresh();
          }).catch(() => {});
        }
      }
    };

    document.addEventListener('visibilitychange', handleResume);
    window.addEventListener('focus', handleResume);

    return () => {
      unsubscribe();
      clearTimeout(timeout);
      document.removeEventListener('visibilitychange', handleResume);
      window.removeEventListener('focus', handleResume);
    };
  }, []); // 重要：認証の初期化とリスナー登録は、アプリ起動時の1回のみに限定する（[refresh]依存を削除）

  // ビューに表示するイベント（非表示カレンダーを除外）
  const visibleCalendarIds = new Set(
    calendars.filter(c => c.visible).map(c => c.id)
  );
  const visibleEvents = events.filter(e => visibleCalendarIds.has(e.calendarId));

  // ナビゲーション
  const navigate = (direction: -1 | 1) => {
    const d = new Date(currentDate);
    switch (viewMode) {
      case 'year':
        d.setFullYear(d.getFullYear() + direction);
        break;
      case 'month':
        d.setMonth(d.getMonth() + direction);
        break;
      case 'week':
        d.setDate(d.getDate() + 7 * direction);
        break;
      case 'day':
        d.setDate(d.getDate() + direction);
        break;
    }
    setCurrentDate(d);
  };

  const goToToday = () => setCurrentDate(new Date());

  // ヘッダーのタイトル表示
  const getTitle = (): string => {
    const y = currentDate.getFullYear();
    const m = currentDate.getMonth() + 1;
    const d = currentDate.getDate();
    switch (viewMode) {
      case 'year':
        return `${y}年`;
      case 'month':
        return `${y}年${m}月`;
      case 'week':
        return `${y}/${m}/${d}〜`;
      case 'day':
        return `${y}/${m}/${d}`;
    }
  };

  // 予定の新規作成を開く
  const openNewEvent = (date?: Date) => {
    setEditingEvent(null);
    setEventFormDate(date || currentDate);
    setShowEventForm(true);
  };

  // 既存予定の編集・詳細を開く
  const openEditEvent = (event: AppEvent) => {
    setEditingEvent(event);
    setEventFormDate(undefined);
    setShowEventForm(true);
  };

  // EventFormを閉じる
  const closeEventForm = () => {
    setShowEventForm(false);
    setEditingEvent(null);
    setEventFormDate(undefined);
  };

  // 1. ユーザーが明示的に保存したカレンダー
  // 2. なければ表示されているカレンダーのうち、書き込み可能な（メアド形式の）最初のカレンダー
  const writableVisibleCalendars = calendars.filter(c => c.visible && c.id.includes('@'));
  const fallbackCalendarId = writableVisibleCalendars[0]?.id;
  const initialCalendarId = defaultCalendarId || fallbackCalendarId;

  // スワイプ操作のステート（refで状態管理して再レンダリングを防ぐ）
  const touchStartX = useRef<number | null>(null);
  const touchEndX = useRef<number | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.targetTouches[0].clientX;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    touchEndX.current = e.targetTouches[0].clientX;
  };

  const handleTouchEnd = () => {
    if (touchStartX.current === null || touchEndX.current === null) return;
    const distance = touchStartX.current - touchEndX.current;
    
    // 50px以上のスワイプを検知
    if (distance > 50) {
      // 左スワイプ（次へ）
      navigate(1);
    } else if (distance < -50) {
      // 右スワイプ（前へ）
      navigate(-1);
    }
    
    // リセット
    touchStartX.current = null;
    touchEndX.current = null;
  };

  if (authLoading && !authState.isSignedIn && !getSavedLoginHint()) {
    return (
      <div className="login-screen">
        <div className="login-card">
          <div className="login-icon">🔄</div>
          <h1>MyCalendar</h1>
          <p>準備中...</p>
        </div>
      </div>
    );
  }

  // 未認証で、かつ過去のログイン記憶（login_hint）もない場合は完全にログイン画面
  const loginHint = getSavedLoginHint();
  if (!authState.isSignedIn && !loginHint) {
    return (
      <div className="login-screen">
        <div className="login-card">
          <div className="login-icon-calendar">
            <span className="login-icon-day">{new Date().getDate()}</span>
          </div>
          <h1>MyCalendar</h1>
          <p>Googleカレンダーの予定を快適に閲覧できます</p>
          <p className="login-subtitle">過去のアーカイブ予定もシームレスに表示</p>

          {CLIENT_ID ? (
            <button className="login-btn" onClick={signIn}>
              Googleでログイン
            </button>
          ) : (
            <div className="login-error">
              <code>.env</code> に <code>VITE_GOOGLE_CLIENT_ID</code> を設定してください
            </div>
          )}
          
          {loginHint && (
            <button className="login-secondary-btn" onClick={signIn}>
              別のアカウントを使用
            </button>
          )}
        </div>
      </div>
    );
  }

  // オフライン・認証切れだが、キャッシュがある状態かどうか
  const hasLoginHint = !!loginHint;
  const isNetworkOffline = !isOnline && hasLoginHint; // WiFi等が切れている
  const isSessionExpired = isOnline && !authState.isSignedIn && hasLoginHint; // ネットはあるがセッション切れ
  const isOfflineMode = isNetworkOffline || isSessionExpired; // ヘッダーのスタイル用

  return (
    <div className="app">
      {/* ネットワークオフラインバナー */}
      {isNetworkOffline && (
        <div className="offline-banner network-offline">
          <span>❌ オフラインです。通信環境を確認してください。手元のデータを表示しています。</span>
        </div>
      )}

      {/* セッション切れバナー */}
      {isSessionExpired && (
        <div className="offline-banner session-expired">
          <span>🔑 セッションが切れました。再接続して最新データを取得してください。</span>
          <button onClick={signIn} className="offline-retry-btn">再接続する</button>
        </div>
      )}

      {/* 同期中バナー */}
      {syncing && (
        <div className="sync-banner">
          <span className="sync-spinner">🔄</span>
          <span>最新2年分のデータを同期中...</span>
        </div>
      )}

      {/* エラー・再接続案内 */}
      {error === 'AUTH_REQUIRED' && (
        <ReconnectButton onReconnect={signIn} />
      )}

      {/* ヘッダー */}
      <header className={`app-header ${isOfflineMode ? 'offline' : ''}`}>
        <div className="header-left">
          <button
            className="menu-btn"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            aria-label="マイカレンダー切替"
            title={sidebarOpen ? 'マイカレンダーを閉じる' : 'マイカレンダーを開く'}
          >
            {sidebarOpen ? '✕' : '☰'}
          </button>
          <h1 className="header-title">{getTitle()}</h1>
        </div>
        <div className="header-center">
          <button className="nav-btn" onClick={() => navigate(-1)} aria-label="前へ">‹</button>
          <button className="today-btn" onClick={goToToday}>今日</button>
          <button className="nav-btn" onClick={() => navigate(1)} aria-label="次へ">›</button>
        </div>
        <div className="header-right">
          <ViewSwitcher viewMode={viewMode} onChange={setViewMode} />
          <button className="search-btn" onClick={() => setShowSearch(true)} aria-label="検索" title="予定を検索">
            🔍
          </button>
          <button className="refresh-btn" onClick={refresh} aria-label="更新" title="予定を更新">
            ↻
          </button>
          <button className="signout-btn" onClick={signOut} title="ログアウト">
            {authState.userEmail ? authState.userEmail.charAt(0).toUpperCase() : '👤'}
          </button>
        </div>
      </header>

      <div className="app-body">
        {/* サイドバー（カレンダー一覧） */}
        <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
          <CalendarList
            calendars={calendars}
            defaultCalendarId={initialCalendarId || null}
            onToggle={toggleCalendarVisibility}
            onSetDefault={setDefaultCalendar}
          />
          {lastSyncTime && (
            <div className="sidebar-footer">
              <div className="sidebar-sync-status">
                <span className="sync-status-icon">📦</span>
                <span>最新2年分の同期完了</span>
                <span className="sync-status-time">
                  {new Date(lastSyncTime).toLocaleDateString()} {new Date(lastSyncTime).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}
                </span>
              </div>
            </div>
          )}
        </aside>

        {/* オーバーレイ（サイドバー開いてる時にタップで閉じる） */}
        {sidebarOpen && (
          <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />
        )}

        {/* カレンダービュー */}
        <main
          className="calendar-main"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          {loading && (
            <>
              <div className="loading-bar" />
              <div className="loading-overlay">
                <div className="loading-message">
                  <span className="loading-spinner">⌛</span>
                  読み込み中...
                </div>
              </div>
            </>
          )}
          {viewMode === 'year' && (
            <YearView
              currentDate={currentDate}
              events={visibleEvents}
              calendars={calendars}
              onMonthClick={(d: Date) => { setCurrentDate(d); setViewMode('month'); }}
            />
          )}
          {viewMode === 'month' && (
            <MonthView
              currentDate={currentDate}
              events={visibleEvents}
              calendars={calendars}
              error={loading ? null : (events.length === 0 ? error : null)} // 予定が0件かつエラーがある場合のみ表示
              onDateClick={(d: Date) => { setCurrentDate(d); setViewMode('day'); }}
              onEventClick={openEditEvent}
              onRefresh={refresh}
            />
          )}
          {viewMode === 'week' && (
            <WeekView
              currentDate={currentDate}
              events={visibleEvents}
              calendars={calendars}
              onEventClick={openEditEvent}
            />
          )}
          {viewMode === 'day' && (
            <DayView
              currentDate={currentDate}
              events={visibleEvents}
              calendars={calendars}
              onEventClick={openEditEvent}
            />
          )}
        </main>
      </div>

      {/* 検索オーバーレイ */}
      {showSearch && (
        <SearchOverlay
          calendars={calendars}
          onClose={() => setShowSearch(false)}
          onEventClick={openEditEvent}
        />
      )}

      {/* FAB: 予定を追加 */}
      <button
        className="fab"
        onClick={() => openNewEvent()}
        title="予定を追加"
        aria-label="予定を追加"
      >
        +
      </button>

      {/* イベントフォーム（モーダル） */}
      {showEventForm && (
        <EventForm
          event={editingEvent}
          calendars={calendars}
          initialDate={eventFormDate}
          initialCalendarId={initialCalendarId}
          onClose={closeEventForm}
          onSaved={refresh}
        />
      )}
    </div>
  );
}

export default App;
