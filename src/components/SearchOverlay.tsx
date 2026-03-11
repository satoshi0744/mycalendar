import { useState, useRef, useEffect } from 'react';
import type { AppEvent, CalendarInfo } from '../data/types';
import { searchEvents } from '../api/calendarClient';
import './SearchOverlay.css';

interface Props {
  calendars: CalendarInfo[];
  onClose: () => void;
  onEventClick: (event: AppEvent) => void;
}

export default function SearchOverlay({ calendars, onClose, onEventClick }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AppEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  
  const inputRef = useRef<HTMLInputElement>(null);

  // 初回マウント時にフォーカスを当てる
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSearch = async () => {
    const trimmed = query.trim();
    if (!trimmed) return;

    setLoading(true);
    setError(null);
    setHasSearched(true);

    try {
      // 検索は表示中のカレンダーのみを対象とする
      const visibleIds = calendars.filter(c => c.visible).map(c => c.id);
      if (visibleIds.length === 0) {
        setResults([]);
        return;
      }
      
      const fetched = await searchEvents(visibleIds, trimmed);
      setResults(fetched);
    } catch (err) {
      setError(err instanceof Error ? err.message : '検索に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  const getCalendarColor = (id: string, eventColor: string | null) => {
    if (eventColor) return eventColor;
    return calendars.find(c => c.id === id)?.color || '#4285f4';
  };

  const formatEventTime = (event: AppEvent) => {
    const dStr = `${event.start.getFullYear()}/${event.start.getMonth() + 1}/${event.start.getDate()}`;
    if (event.isAllDay) return `${dStr} (終日)`;
    
    const tStr = event.start.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
    return `${dStr} ${tStr}`;
  };

  return (
    <div className="search-overlay">
      <div className="search-panel">
        {/* ヘッダー＆検索バー */}
        <div className="search-header">
          <div className="search-input-wrapper">
            <span className="search-icon">🔍</span>
            <input
              ref={inputRef}
              type="text"
              className="search-input"
              placeholder="予定を検索..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            {query && (
              <button 
                className="search-clear-btn" 
                onClick={() => { setQuery(''); inputRef.current?.focus(); }}
              >
                ✕
              </button>
            )}
          </div>
          <button className="search-close-btn" onClick={onClose} title="閉じる">
            完了
          </button>
        </div>

        {/* 検索結果エリア */}
        <div className="search-body">
          {loading && (
            <div className="search-status">
              <span className="search-spinner">↻</span> 検索中...
            </div>
          )}
          
          {error && (
            <div className="search-status search-error">
              {error}
            </div>
          )}

          {!loading && !error && hasSearched && results.length === 0 && (
            <div className="search-status">
              「{query}」に一致する予定は見つかりませんでした。
            </div>
          )}

          {!loading && !error && results.length > 0 && (
            <div className="search-results">
              <div className="search-results-count">
                {results.length} 件見つかりました
              </div>
              <ul className="search-results-list">
                {results.map((event) => (
                  <li 
                    key={event.id} 
                    className="search-result-item"
                    onClick={() => onEventClick(event)}
                  >
                    <div 
                      className="search-result-color" 
                      style={{ backgroundColor: getCalendarColor(event.calendarId, event.eventColor) }} 
                    />
                    <div className="search-result-content">
                      <div className="search-result-title">{event.title}</div>
                      <div className="search-result-time">{formatEventTime(event)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
