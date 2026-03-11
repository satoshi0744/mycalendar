import { useMemo } from 'react';
import type { AppEvent, CalendarInfo } from '../data/types';
import './YearView.css';

interface Props {
  currentDate: Date;
  events: AppEvent[];
  calendars: CalendarInfo[];
  onMonthClick: (date: Date) => void;
}

/** 月曜始まりの曜日インデックス (月=0, ... 日=6) */
function getMondayBasedDay(d: Date): number {
  return (d.getDay() + 6) % 7;
}

const DAY_LABELS = ['月', '火', '水', '木', '金', '土', '日'];
const MONTH_NAMES = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

export default function YearView({ currentDate, events, calendars, onMonthClick }: Props) {
  const year = currentDate.getFullYear();
  const today = new Date();

  // 月ごとのイベント数を集計
  const eventCountByMonth = useMemo(() => {
    const counts = new Array(12).fill(0);
    for (const event of events) {
      const m = event.start.getMonth();
      counts[m]++;
    }
    return counts;
  }, [events]);

  // カレンダーIDから色を引くマップ
  const colorMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of calendars) m.set(c.id, c.color);
    return m;
  }, [calendars]);

  // 日付ごとのイベントをマップ化
  const eventsByDate = useMemo(() => {
    const map = new Map<string, AppEvent[]>();
    for (const event of events) {
      const key = `${event.start.getMonth()}-${event.start.getDate()}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(event);
    }
    return map;
  }, [events]);

  const isToday = (y: number, m: number, d: number) =>
    d === today.getDate() &&
    m === today.getMonth() &&
    y === today.getFullYear();

  // 月のミニカレンダーを生成
  const renderMonth = (monthIndex: number) => {
    const firstDay = new Date(year, monthIndex, 1);
    const lastDay = new Date(year, monthIndex + 1, 0);
    const startOffset = getMondayBasedDay(firstDay);

    const days: (number | null)[] = [];
    // 前月の空セル
    for (let i = 0; i < startOffset; i++) days.push(null);
    // 当月の日
    for (let d = 1; d <= lastDay.getDate(); d++) days.push(d);

    // 7の倍数になるまで埋める
    while (days.length % 7 !== 0) days.push(null);

    const weeks: (number | null)[][] = [];
    for (let i = 0; i < days.length; i += 7) {
      weeks.push(days.slice(i, i + 7));
    }

    return (
      <div
        key={monthIndex}
        className="year-month-card"
        onClick={() => onMonthClick(new Date(year, monthIndex, 1))}
      >
        <div className="year-month-header">
          <span className="year-month-name">{MONTH_NAMES[monthIndex]}</span>
          {eventCountByMonth[monthIndex] > 0 && (
            <span className="year-month-count">{eventCountByMonth[monthIndex]}</span>
          )}
        </div>

        {/* 曜日ヘッダー */}
        <div className="year-month-days-header">
          {DAY_LABELS.map((label, i) => (
            <span
              key={i}
              className={`year-dow ${i === 5 ? 'saturday' : ''} ${i === 6 ? 'sunday' : ''}`}
            >
              {label}
            </span>
          ))}
        </div>

        {/* 日付グリッド */}
        <div className="year-month-grid">
          {weeks.map((week, wi) => (
            <div key={wi} className="year-week-row">
              {week.map((day, di) => {
                if (day === null) {
                  return <span key={di} className="year-day empty" />;
                }

                const dateKey = `${monthIndex}-${day}`;
                const dayEvents = eventsByDate.get(dateKey) || [];
                const isTodayCell = isToday(year, monthIndex, day);

                return (
                  <span
                    key={di}
                    className={`year-day ${isTodayCell ? 'today' : ''} ${dayEvents.length > 0 ? 'has-events' : ''}`}
                    title={dayEvents.length > 0 ? `${day}日: ${dayEvents.length}件の予定` : undefined}
                  >
                    {day}
                    {dayEvents.length > 0 && (
                      <span
                        className="year-day-dot"
                        style={{ backgroundColor: dayEvents[0].eventColor || colorMap.get(dayEvents[0].calendarId) || '#4285f4' }}
                      />
                    )}
                  </span>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="year-view">
      <div className="year-grid">
        {Array.from({ length: 12 }, (_, i) => renderMonth(i))}
      </div>
    </div>
  );
}
