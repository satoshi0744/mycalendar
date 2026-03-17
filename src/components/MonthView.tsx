import { useMemo } from 'react';
import type { AppEvent, CalendarInfo } from '../data/types';
import './MonthView.css';

interface Props {
  currentDate: Date;
  events: AppEvent[];
  calendars: CalendarInfo[];
  error?: string | null;
  onDateClick: (date: Date) => void;
  onEventClick?: (event: AppEvent) => void;
  onRefresh?: () => void;
}

/** 月曜始まりの曜日インデックス (月=0, 火=1, ... 日=6) */
function getMondayBasedDay(d: Date): number {
  return (d.getDay() + 6) % 7;
}

/** 日付の年月日だけを比較して同一日かチェック */
function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

/** 日付aがbより前の日か */
function isBeforeDay(a: Date, b: Date): boolean {
  const aDate = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const bDate = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return aDate.getTime() < bDate.getTime();
}

export default function MonthView({ currentDate, events, calendars, error, onDateClick, onEventClick, onRefresh }: Props) {
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const today = new Date();

  // カレンダーグリッド用の日付配列を生成（月曜始まり）
  const weeks = useMemo(() => {
    const firstDay = new Date(year, month, 1);
    const startDate = new Date(firstDay);
    startDate.setDate(startDate.getDate() - getMondayBasedDay(firstDay));

    const grid: Date[][] = [];
    const d = new Date(startDate);

    for (let w = 0; w < 6; w++) {
      const week: Date[] = [];
      for (let i = 0; i < 7; i++) {
        week.push(new Date(d));
        d.setDate(d.getDate() + 1);
      }
      grid.push(week);
    }

    return grid;
  }, [year, month]);

  // 日付ごとのイベントをマップ化してソートする
  const eventsByDate = useMemo(() => {
    const map = new Map<string, AppEvent[]>();
    for (const event of events) {
      const key = formatDateKey(event.start);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(event);
    }
    // 各日のイベントを「終日が先、そのあと開始時間順」にソート
    for (const [key, evs] of map.entries()) {
      evs.sort((a, b) => {
        if (a.isAllDay && !b.isAllDay) return -1;
        if (!a.isAllDay && b.isAllDay) return 1;
        return a.start.getTime() - b.start.getTime();
      });
      map.set(key, evs);
    }
    return map;
  }, [events]);

  // カレンダーIDから色を引くマップ
  const colorMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of calendars) m.set(c.id, c.color);
    return m;
  }, [calendars]);

  const isCurrentMonth = (d: Date) => d.getMonth() === month;

  // 月曜始まりの曜日ヘッダー
  const dayHeaders = ['月', '火', '水', '木', '金', '土', '日'];

  return (
    <div className="month-view">
      {/* 曜日ヘッダー */}
      <div className="month-header">
        {dayHeaders.map((dow, i) => (
          <div
            key={dow}
            className={`month-header-cell ${i === 5 ? 'saturday' : ''} ${i === 6 ? 'sunday' : ''}`}
          >
            {dow}
          </div>
        ))}
      </div>

      {/* 日付グリッド */}
      <div className="month-grid">
        {error === 'AUTH_REQUIRED' && (
          <div className="auth-required-overlay">
            <div className="auth-required-card">
              <p>カレンダーを同期するために、もう一度ログインをお願いします。</p>
              <button className="auth-reconnect-btn" onClick={onRefresh}>
                Googleでログイン
              </button>
            </div>
          </div>
        )}
        {weeks.map((week, wi) => (
          <div key={wi} className="month-row">
            {week.map((date, di) => {
              const key = formatDateKey(date);
              const dayEvents = eventsByDate.get(key) || [];
              const isMobile = typeof window !== 'undefined' && window.innerWidth <= 768;
              const maxDisplay = isMobile ? 4 : 3;
              const isPast = isBeforeDay(date, today);
              const isTodayCell = isSameDay(date, today);

              return (
                <div
                  key={di}
                  className={[
                    'month-cell',
                    !isCurrentMonth(date) ? 'other-month' : '',
                    isPast ? 'past' : '',
                    isTodayCell ? 'today' : '',
                  ].filter(Boolean).join(' ')}
                  onClick={() => onDateClick(date)}
                >
                  <span className={`month-date ${isTodayCell ? 'today-circle' : ''}`}>
                    {date.getDate()}
                  </span>
                  <div className="month-events">
                    {dayEvents.slice(0, maxDisplay).map((event, i) => {
                      const evColor = event.eventColor || colorMap.get(event.calendarId) || '#4285f4';
                      return (
                      <div
                        key={i}
                        className={[
                          'month-event',
                          // すべてのイベントをall-day風の背景にするため、一律でクラスを付与
                          'all-day-style',
                          isPast ? 'past-event' : '',
                        ].filter(Boolean).join(' ')}
                        style={{ backgroundColor: evColor }}
                        title={event.title}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (onEventClick) onEventClick(event);
                        }}
                      >
                        {/* 時刻表示は削除し、タイトルのみにする */}
                        <span className="month-event-title">{event.title}</span>
                      </div>
                      );
                    })}
                    {dayEvents.length > maxDisplay && (
                      <div className="month-event-more">
                        +{dayEvents.length - maxDisplay}件
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function formatDateKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
