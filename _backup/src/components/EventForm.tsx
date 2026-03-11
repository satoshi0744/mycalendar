import { useState } from 'react';
import type { AppEvent, CalendarInfo } from '../data/types';
import { createEvent, updateEvent, deleteEvent } from '../api/calendarClient';
import './EventForm.css';

/** Google Calendar APIの11色 */
const EVENT_COLORS: { id: string; color: string; name: string }[] = [
  { id: '',   color: '',        name: 'カレンダーの色' },
  { id: '1',  color: '#7986cb', name: 'ラベンダー' },
  { id: '2',  color: '#33b679', name: 'セージ' },
  { id: '3',  color: '#8e24aa', name: 'ブドウ' },
  { id: '4',  color: '#e67c73', name: 'フラミンゴ' },
  { id: '5',  color: '#f6bf26', name: 'バナナ' },
  { id: '6',  color: '#f4511e', name: 'ミカン' },
  { id: '7',  color: '#039be5', name: 'ピーコック' },
  { id: '8',  color: '#616161', name: 'グラファイト' },
  { id: '9',  color: '#3f51b5', name: 'ブルーベリー' },
  { id: '10', color: '#0b8043', name: 'バジル' },
  { id: '11', color: '#d50000', name: 'トマト' },
];

interface Props {
  /** 編集対象のイベント（nullなら新規作成モード） */
  event: AppEvent | null;
  /** 利用可能なカレンダー一覧 */
  calendars: CalendarInfo[];
  /** フォームを開いた時の初期日時（新規作成時に使用） */
  initialDate?: Date;
  /** フォームを閉じる */
  onClose: () => void;
  /** 保存・削除後にデータを再読込する */
  onSaved: () => void;
}

export default function EventForm({
  event,
  calendars,
  initialDate,
  onClose,
  onSaved,
}: Props) {
  const isEdit = event !== null;

  // 書き込み可能なカレンダー（IDがメールアドレス形式のものはオーナーカレンダー）
  const writableCalendars = calendars.filter(c => c.id.includes('@'));
  const defaultCalendarId = event?.calendarId || writableCalendars[0]?.id || calendars[0]?.id || '';

  // 初期値の計算
  const defaultStart = event ? event.start : (initialDate || new Date());
  const defaultEnd = event ? event.end : new Date(defaultStart.getTime() + 60 * 60 * 1000);

  // イベント色の初期値を逆引き（hex→colorId）
  const initialColorId = event?.eventColor
    ? (EVENT_COLORS.find(c => c.color === event.eventColor)?.id || '')
    : '';

  const [title, setTitle] = useState(event?.title || '');
  const [description, setDescription] = useState(event?.description || '');
  const [location, setLocation] = useState(event?.location || '');
  const [calendarId, setCalendarId] = useState(defaultCalendarId);
  const [isAllDay, setIsAllDay] = useState(event?.isAllDay || false);
  const [startDate, setStartDate] = useState(formatDateForInput(defaultStart));
  const [startTime, setStartTime] = useState(formatTimeForInput(defaultStart));
  const [endDate, setEndDate] = useState(formatDateForInput(defaultEnd));
  const [endTime, setEndTime] = useState(formatTimeForInput(defaultEnd));
  const [colorId, setColorId] = useState(initialColorId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!title.trim()) {
      setError('タイトルを入力してください');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const startDt = isAllDay
        ? new Date(`${startDate}T00:00:00`)
        : new Date(`${startDate}T${startTime}`);
      const endDt = isAllDay
        ? new Date(`${endDate}T00:00:00`)
        : new Date(`${endDate}T${endTime}`);

      if (endDt <= startDt && !isAllDay) {
        setError('終了は開始より後に設定してください');
        setSaving(false);
        return;
      }

      const eventData = {
        title: title.trim(),
        description,
        location,
        start: startDt,
        end: endDt,
        isAllDay,
        colorId: colorId || undefined,
      };

      if (isEdit && event) {
        await updateEvent(event.calendarId, event.id, eventData);
      } else {
        await createEvent(calendarId, eventData);
      }

      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!event) return;
    if (!confirm('この予定を削除しますか？')) return;

    setSaving(true);
    setError(null);

    try {
      await deleteEvent(event.calendarId, event.id);
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '削除に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  // カレンダー色のプレビュー
  const selectedCalColor = calendars.find(c => c.id === calendarId)?.color || '#4285f4';
  // 実際に表示する色（イベント色 > カレンダー色）
  const displayColor = colorId
    ? EVENT_COLORS.find(c => c.id === colorId)?.color || selectedCalColor
    : selectedCalColor;

  return (
    <div className="event-form-overlay" onClick={onClose}>
      <div className="event-form" onClick={e => e.stopPropagation()}>
        {/* ヘッダー */}
        <div className="event-form-header">
          <h2>{isEdit ? '予定を編集' : '予定を追加'}</h2>
          <button className="event-form-close" onClick={onClose} aria-label="閉じる">×</button>
        </div>

        {/* カラーバー */}
        <div className="event-form-color-bar" style={{ backgroundColor: displayColor }} />

        {/* フォーム本体 */}
        <div className="event-form-body">
          {/* タイトル */}
          <input
            type="text"
            className="event-form-title"
            placeholder="タイトルを追加"
            value={title}
            onChange={e => setTitle(e.target.value)}
            autoFocus
          />

          {/* 終日トグル */}
          <label className="event-form-allday">
            <input
              type="checkbox"
              checked={isAllDay}
              onChange={e => setIsAllDay(e.target.checked)}
            />
            <span>終日</span>
          </label>

          {/* 日時 */}
          <div className="event-form-datetime">
            <div className="event-form-row">
              <label>開始</label>
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
              />
              {!isAllDay && (
                <input
                  type="time"
                  value={startTime}
                  onChange={e => setStartTime(e.target.value)}
                />
              )}
            </div>
            <div className="event-form-row">
              <label>終了</label>
              <input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
              />
              {!isAllDay && (
                <input
                  type="time"
                  value={endTime}
                  onChange={e => setEndTime(e.target.value)}
                />
              )}
            </div>
          </div>

          {/* 場所 */}
          <div className="event-form-field">
            <span className="event-form-field-label">場所</span>
            <input
              type="text"
              placeholder="場所を追加"
              value={location}
              onChange={e => setLocation(e.target.value)}
            />
          </div>

          {/* 説明 */}
          <div className="event-form-field">
            <span className="event-form-field-label">説明</span>
            <textarea
              placeholder="説明を追加"
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
            />
          </div>

          {/* カレンダー選択（新規作成時のみ） */}
          {!isEdit && writableCalendars.length > 1 && (
            <div className="event-form-field">
              <span className="event-form-field-label">カレンダー</span>
              <select
                value={calendarId}
                onChange={e => setCalendarId(e.target.value)}
              >
                {writableCalendars.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* 色選択 */}
          <div className="event-form-field">
            <span className="event-form-field-label">色</span>
            <div className="event-form-colors">
              {EVENT_COLORS.map(c => (
                <button
                  key={c.id || 'default'}
                  className={`event-form-color-btn ${colorId === c.id ? 'selected' : ''}`}
                  style={{ backgroundColor: c.color || selectedCalColor }}
                  title={c.name}
                  onClick={() => setColorId(c.id)}
                  type="button"
                />
              ))}
            </div>
          </div>

          {/* エラー表示 */}
          {error && <div className="event-form-error">{error}</div>}
        </div>

        {/* フッター */}
        <div className="event-form-footer">
          {isEdit && (
            <button
              className="event-form-delete-btn"
              onClick={handleDelete}
              disabled={saving}
            >
              削除
            </button>
          )}
          <div className="event-form-footer-right">
            <button className="event-form-cancel-btn" onClick={onClose} disabled={saving}>
              キャンセル
            </button>
            <button className="event-form-save-btn" onClick={handleSave} disabled={saving}>
              {saving ? '保存中...' : '保存'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- ユーティリティ ---

function formatDateForInput(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatTimeForInput(d: Date): string {
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}
