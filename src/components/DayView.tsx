import { useMemo } from 'react';
import type { AppEvent, CalendarInfo } from '../data/types';
import './DayView.css';

interface Props {
  currentDate: Date;
  events: AppEvent[];
  calendars: CalendarInfo[];
  onEventClick?: (event: AppEvent) => void;
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);

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

export default function DayView({ currentDate, events, calendars, onEventClick }: Props) {
  // カレンダーIDから色を引くマップ
  const colorMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of calendars) m.set(c.id, c.color);
    return m;
  }, [calendars]);

  // 当日のイベントをフィルタ
  const todayEvents = useMemo(() => {
    const dayStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate());
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    return events.filter(e => {
      const eStart = new Date(e.start);
      const eEnd = new Date(e.end);
      return eStart < dayEnd && eEnd > dayStart;
    });
  }, [currentDate, events]);

  const allDayEvents = todayEvents.filter(e => e.isAllDay);
  const timedEvents = todayEvents.filter(e => !e.isAllDay);

  const layoutMap = useMemo(() => {
    return calculateOverlap(timedEvents);
  }, [timedEvents]);

  const formatHour = (h: number) =>
    `${String(h).padStart(2, '0')}:00`;

  const dow = ['日曜日', '月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日'][currentDate.getDay()];

  return (
    <div className="day-view">
      {/* 日付ヘッダー */}
      <div className="day-header">
        <span className="day-header-dow">{dow}</span>
      </div>

      {/* 終日イベント */}
      {allDayEvents.length > 0 && (
        <div className="day-allday-section">
          <div className="day-allday-label">終日</div>
          <div className="day-allday-events">
            {allDayEvents.map((event, i) => (
              <div
                key={i}
                className="day-allday-event"
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
        </div>
      )}

      {/* タイムグリッド */}
      <div className="day-body">
        {HOURS.map(hour => (
          <div key={hour} className="day-hour-row">
            <div className="day-time-gutter">
              {hour > 0 && <span>{formatHour(hour)}</span>}
            </div>
            <div className="day-hour-cell">
              {timedEvents
                .filter(e => e.start.getHours() === hour)
                .map((event, i) => {
                  const durationMinutes = (event.end.getTime() - event.start.getTime()) / 60000;
                  const heightPx = Math.max(24, (durationMinutes / 60) * 60);
                  const topOffset = (event.start.getMinutes() / 60) * 60;

                  const layout = layoutMap.get(event.id) || { column: 0, totalColumns: 1 };
                  const leftPct = (100 / layout.totalColumns) * layout.column;
                  const widthPct = 100 / layout.totalColumns;

                  return (
                    <div
                      key={i}
                      className="day-event"
                      style={{
                        borderLeftColor: event.eventColor || colorMap.get(event.calendarId) || '#4285f4',
                        backgroundColor: `${event.eventColor || colorMap.get(event.calendarId) || '#4285f4'}18`,
                        height: `${heightPx}px`,
                        top: `${topOffset}px`,
                        left: `calc(${leftPct}% + 4px)`,
                        width: `calc(${widthPct}% - 8px)`,
                        right: 'auto',
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (onEventClick) onEventClick(event);
                      }}
                    >
                      <div className="day-event-time">
                        {event.start.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
                        {' - '}
                        {event.end.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
                      </div>
                      <div className="day-event-title">{event.title}</div>
                      {event.location && (
                        <div className="day-event-location">📍 {event.location}</div>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
