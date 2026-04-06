import { useMemo, useRef, useEffect } from 'react';
import type { AppEvent, CalendarInfo } from '../data/types';
import './WeekView.css';

interface Props {
  currentDate: Date;
  events: AppEvent[];
  calendars: CalendarInfo[];
  onEventClick?: (event: AppEvent) => void;
}

/** 日付aがbより前の日か */
function isBeforeDay(a: Date, b: Date): boolean {
  const aDate = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const bDate = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return aDate.getTime() < bDate.getTime();
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const HOUR_HEIGHT = 64; // 1時間あたりの高さ(px)
const DEFAULT_SCROLL_HOUR = 6.5; // デフォルトのスクロール位置(6:30)

/** 月曜始まりの曜日インデックス (月=0, 火=1, ... 日=6) */
function getMondayBasedDay(d: Date): number {
  return (d.getDay() + 6) % 7;
}

/** 月曜始まりの曜日ラベル */
const DAY_LABELS = ['月', '火', '水', '木', '金', '土', '日'];

function calculateOverlap(events: AppEvent[]) {
  const sorted = [...events].sort((a, b) => {
    if (a.start.getTime() !== b.start.getTime()) return a.start.getTime() - b.start.getTime();
    return b.end.getTime() - a.end.getTime();
  });

  const layouts = new Map<string, { column: number; totalColumns: number }>();
  let columns: AppEvent[][] = [];
  let lastEventEnding: Date | null = null;
  let currentCluster: AppEvent[] = [];

  const packCluster = () => {
    currentCluster.forEach(ev => {
      layouts.set(ev.id, {
        column: columns.findIndex(col => col.includes(ev)),
        totalColumns: columns.length,
      });
    });
  };

  for (const event of sorted) {
    if (lastEventEnding !== null && event.start.getTime() >= lastEventEnding.getTime()) {
      packCluster();
      columns = [];
      currentCluster = [];
      lastEventEnding = null;
    }

    let placed = false;
    for (const col of columns) {
      const lastEventInCol = col[col.length - 1];
      if (lastEventInCol.end.getTime() <= event.start.getTime()) {
        col.push(event);
        placed = true;
        break;
      }
    }
    if (!placed) {
      columns.push([event]);
    }
    currentCluster.push(event);

    if (lastEventEnding === null || event.end.getTime() > lastEventEnding.getTime()) {
      lastEventEnding = event.end;
    }
  }
  if (currentCluster.length > 0) packCluster();

  return layouts;
}

export default function WeekView({ currentDate, events, calendars, onEventClick }: Props) {
  const today = new Date();
  const bodyRef = useRef<HTMLDivElement>(null);

  // 週のビューが表示された時、6:30の位置に自動スクロール
  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = DEFAULT_SCROLL_HOUR * HOUR_HEIGHT;
    }
  }, [currentDate]);

  // 週の日付配列（月曜始まり）
  const weekDates = useMemo(() => {
    const d = new Date(currentDate);
    d.setDate(d.getDate() - getMondayBasedDay(d));
    return Array.from({ length: 7 }, (_, i) => {
      const date = new Date(d);
      date.setDate(date.getDate() + i);
      return date;
    });
  }, [currentDate]);

  // カレンダーIDから色を引くマップ
  const colorMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of calendars) m.set(c.id, c.color);
    return m;
  }, [calendars]);

  // 終日イベント
  const allDayEvents = useMemo(() =>
    events.filter(e => e.isAllDay), [events]);

  // 時刻付きイベントを日ごとに分類（月曜始まりインデックス）
  const timedEventsByDay = useMemo(() => {
    const map = new Map<number, AppEvent[]>();
    for (const event of events) {
      if (event.isAllDay) continue;
      // weekDatesの中で一致する日のインデックスを探す
      for (let di = 0; di < weekDates.length; di++) {
        const wd = weekDates[di];
        if (event.start.getFullYear() === wd.getFullYear() &&
            event.start.getMonth() === wd.getMonth() &&
            event.start.getDate() === wd.getDate()) {
          if (!map.has(di)) map.set(di, []);
          map.get(di)!.push(event);
          break;
        }
      }
    }
    return map;
  }, [events, weekDates]);

  // オーバーラップ計算は各日ごとに独立して行う
  const layoutsByDay = useMemo(() => {
    const map = new Map<number, Map<string, { column: number; totalColumns: number }>>();
    for (const [di, dayEvents] of timedEventsByDay.entries()) {
      map.set(di, calculateOverlap(dayEvents));
    }
    return map;
  }, [timedEventsByDay]);

  const isToday = (d: Date) =>
    d.getDate() === today.getDate() &&
    d.getMonth() === today.getMonth() &&
    d.getFullYear() === today.getFullYear();

  const formatHour = (h: number) =>
    `${String(h).padStart(2, '0')}:00`;

  return (
    <div className="week-view">
      {/* 終日イベント領域 */}
      {allDayEvents.length > 0 && (
        <div className="week-allday-section">
          <div className="week-allday-label">終日</div>
          <div className="week-allday-grid">
            {weekDates.map((_, di) => (
              <div key={di} className="week-allday-cell">
                {allDayEvents
                  .filter(e => {
                    const eStart = new Date(e.start);
                    const eEnd = new Date(e.end);
                    const dayStart = new Date(weekDates[di]);
                    const dayEnd = new Date(dayStart);
                    dayEnd.setDate(dayEnd.getDate() + 1);
                    return eStart < dayEnd && eEnd > dayStart;
                  })
                  .map((event, i) => (
                    <div
                      key={i}
                      className={`week-allday-event ${isBeforeDay(event.start, today) ? 'past-event' : ''}`}
                      style={{ backgroundColor: event.eventColor || colorMap.get(event.calendarId) || '#4285f4' }}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (onEventClick) onEventClick(event);
                      }}
                    >
                      {event.title}
                    </div>
                  ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ヘッダー（曜日と日付） */}
      <div className="week-header">
        <div className="week-time-gutter-header" />
        {weekDates.map((date, i) => (
          <div key={i} className={`week-day-header ${isToday(date) ? 'today' : ''}`}>
            <span className="week-dow">
              {DAY_LABELS[i]}
            </span>
            <span className={`week-day-num ${isToday(date) ? 'today-circle' : ''}`}>
              {date.getDate()}
            </span>
          </div>
        ))}
      </div>

      {/* タイムグリッド */}
      <div className="week-body" ref={bodyRef}>
        {HOURS.map(hour => (
          <div key={hour} className="week-hour-row">
            <div className="week-time-gutter">
              {hour > 0 && <span>{formatHour(hour)}</span>}
            </div>
            {weekDates.map((_, di) => (
              <div key={di} className={`week-hour-cell ${isToday(weekDates[di]) ? 'today-col' : ''}`}>
                {(timedEventsByDay.get(di) || [])
                  .filter(e => e.start.getHours() === hour)
                  .map((event, i) => {
                    const durationMinutes = (event.end.getTime() - event.start.getTime()) / 60000;
                    const heightPx = Math.max(20, (durationMinutes / 60) * HOUR_HEIGHT);
                    const topOffset = (event.start.getMinutes() / 60) * HOUR_HEIGHT;

                    const layoutMap = layoutsByDay.get(di);
                    const layout = layoutMap?.get(event.id) || { column: 0, totalColumns: 1 };
                    const leftPct = (100 / layout.totalColumns) * layout.column;
                    const widthPct = 100 / layout.totalColumns;

                    return (
                      <div
                        key={i}
                        className={`week-event ${isBeforeDay(event.start, today) ? 'past-event' : ''}`}
                        style={{
                          borderLeftColor: event.eventColor || colorMap.get(event.calendarId) || '#4285f4',
                          backgroundColor: `${event.eventColor || colorMap.get(event.calendarId) || '#4285f4'}18`,
                          height: `${heightPx}px`,
                          top: `${topOffset}px`,
                          left: `calc(${leftPct}% + 1px)`,
                          width: `calc(${widthPct}% - 2px)`,
                          right: 'auto',
                        }}
                        title={`${event.title}\n${event.start.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })} - ${event.end.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (onEventClick) onEventClick(event);
                        }}
                      >
                        <span className="week-event-time">
                          {event.start.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        <span className="week-event-title">{event.title}</span>
                      </div>
                    );
                  })}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
