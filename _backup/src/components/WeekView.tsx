import { useMemo } from 'react';
import type { AppEvent, CalendarInfo } from '../data/types';
import './WeekView.css';

interface Props {
  currentDate: Date;
  events: AppEvent[];
  calendars: CalendarInfo[];
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);

/** 月曜始まりの曜日インデックス (月=0, 火=1, ... 日=6) */
function getMondayBasedDay(d: Date): number {
  return (d.getDay() + 6) % 7;
}

/** 月曜始まりの曜日ラベル */
const DAY_LABELS = ['月', '火', '水', '木', '金', '土', '日'];

export default function WeekView({ currentDate, events, calendars }: Props) {
  const today = new Date();

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
                      className="week-allday-event"
                      style={{ backgroundColor: event.eventColor || colorMap.get(event.calendarId) || '#4285f4' }}
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
      <div className="week-body">
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
                    const heightPx = Math.max(20, (durationMinutes / 60) * 48);
                    const topOffset = (event.start.getMinutes() / 60) * 48;

                    return (
                      <div
                        key={i}
                        className="week-event"
                        style={{
                          borderLeftColor: event.eventColor || colorMap.get(event.calendarId) || '#4285f4',
                          backgroundColor: `${event.eventColor || colorMap.get(event.calendarId) || '#4285f4'}18`,
                          height: `${heightPx}px`,
                          top: `${topOffset}px`,
                        }}
                        title={`${event.title}\n${event.start.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })} - ${event.end.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}`}
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
