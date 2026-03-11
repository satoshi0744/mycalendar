import { useState, useEffect } from 'react';
import type { AuthState, AppEvent } from './data/types';
import { initAuth, signIn, signOut, onAuthStateChange, getAuthState } from './auth/GoogleAuth';
import { useCalendarData } from './hooks/useCalendarData';
import YearView from './components/YearView';
import MonthView from './components/MonthView';
import WeekView from './components/WeekView';
import DayView from './components/DayView';
import ViewSwitcher from './components/ViewSwitcher';
import CalendarList from './components/CalendarList';
import EventForm from './components/EventForm';
import './App.css';

// Google Cloud Console で取得したクライアントID
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

function App() {
  const [authState, setAuthState] = useState<AuthState>(getAuthState());
  const [authLoading, setAuthLoading] = useState(true); // 認証復元中のローディング
  const [sidebarOpen, setSidebarOpen] = useState(false); // サイドバー開閉（統一）
  const [showEventForm, setShowEventForm] = useState(false);
  const [editingEvent, setEditingEvent] = useState<AppEvent | null>(null);
  const [eventFormDate, setEventFormDate] = useState<Date | undefined>(undefined);

  const {
    events,
    calendars,
    loading,
    currentDate,
    viewMode,
    setCurrentDate,
    setViewMode,
    toggleCalendarVisibility,
    refresh,
  } = useCalendarData();

  useEffect(() => {
    if (CLIENT_ID) {
      initAuth(CLIENT_ID);
    }
    const unsubscribe = onAuthStateChange((state) => {
      setAuthState(state);
      setAuthLoading(false); // 認証状態が確定したらローディング終了
    });
    // 5秒経っても認証状態が来なければローディング終了（タイムアウト）
    const timeout = setTimeout(() => setAuthLoading(false), 5000);
    return () => {
      unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

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

  // EventFormを閉じる
  const closeEventForm = () => {
    setShowEventForm(false);
    setEditingEvent(null);
    setEventFormDate(undefined);
  };

  // 認証復元中のローディング画面
  if (authLoading && !authState.isSignedIn) {
    return (
      <div className="login-screen">
        <div className="login-card">
          <div className="login-icon">🔄</div>
          <h1>MyCalendar</h1>
          <p>ログイン中...</p>
        </div>
      </div>
    );
  }

  // 未認証の場合はログイン画面
  if (!authState.isSignedIn) {
    return (
      <div className="login-screen">
        <div className="login-card">
          <div className="login-icon-calendar">
            <span className="login-icon-day">{new Date().getDate()}</span>
          </div>
          <h1>MyCalendar</h1>
          <p>Googleカレンダーのビューアアプリ</p>
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
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      {/* ヘッダー */}
      <header className="app-header">
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
            onToggle={toggleCalendarVisibility}
          />
        </aside>

        {/* オーバーレイ（サイドバー開いてる時にタップで閉じる） */}
        {sidebarOpen && (
          <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />
        )}

        {/* カレンダービュー */}
        <main className="calendar-main">
          {loading && <div className="loading-bar" />}
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
              onDateClick={(d: Date) => { setCurrentDate(d); setViewMode('day'); }}
            />
          )}
          {viewMode === 'week' && (
            <WeekView
              currentDate={currentDate}
              events={visibleEvents}
              calendars={calendars}
            />
          )}
          {viewMode === 'day' && (
            <DayView
              currentDate={currentDate}
              events={visibleEvents}
              calendars={calendars}
            />
          )}
        </main>
      </div>

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
          onClose={closeEventForm}
          onSaved={refresh}
        />
      )}
    </div>
  );
}

export default App;
