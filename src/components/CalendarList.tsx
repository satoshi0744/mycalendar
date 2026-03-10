import { useState } from 'react';
import type { CalendarInfo } from '../data/types';
import './CalendarList.css';

interface Props {
  calendars: CalendarInfo[];
  onToggle: (calendarId: string) => void;
}

export default function CalendarList({ calendars, onToggle }: Props) {
  const [collapsed, setCollapsed] = useState(false);

  if (calendars.length === 0) {
    return (
      <div className="calendar-list">
        <div className="calendar-list-header" onClick={() => setCollapsed(!collapsed)}>
          <span className={`calendar-list-arrow ${collapsed ? 'collapsed' : ''}`}>▾</span>
          <h3 className="calendar-list-title">マイカレンダー</h3>
        </div>
        <p className="calendar-list-empty">カレンダーを読み込み中...</p>
      </div>
    );
  }

  return (
    <div className="calendar-list">
      <div className="calendar-list-header" onClick={() => setCollapsed(!collapsed)}>
        <span className={`calendar-list-arrow ${collapsed ? 'collapsed' : ''}`}>▾</span>
        <h3 className="calendar-list-title">マイカレンダー</h3>
        <span className="calendar-list-count">{calendars.length}</span>
      </div>
      {!collapsed && (
        <ul className="calendar-list-items">
          {calendars.map(cal => (
            <li key={cal.id} className="calendar-list-item">
              <label className="calendar-list-label">
                <input
                  type="checkbox"
                  checked={cal.visible}
                  onChange={() => onToggle(cal.id)}
                  className="calendar-checkbox"
                />
                <span
                  className="calendar-color-dot"
                  style={{ backgroundColor: cal.color }}
                />
                <span className="calendar-name">{cal.name}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
