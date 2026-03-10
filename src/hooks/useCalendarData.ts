/**
 * MyCalendar - カレンダーデータ取得カスタムフック
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { AppEvent, CalendarInfo, ViewMode } from '../data/types';
import { getEventsForRange, getAllCalendars } from '../data/eventRepository';
import { isAuthenticated } from '../auth/GoogleAuth';

interface UseCalendarDataReturn {
  events: AppEvent[];
  calendars: CalendarInfo[];
  loading: boolean;
  error: string | null;
  currentDate: Date;
  viewMode: ViewMode;
  setCurrentDate: (date: Date) => void;
  setViewMode: (mode: ViewMode) => void;
  toggleCalendarVisibility: (calendarId: string) => void;
  refresh: () => void;
}

/**
 * 現在のビューモードと日付に基づいてイベントを取得するフック。
 */
export function useCalendarData(): UseCalendarDataReturn {
  const [events, setEvents] = useState<AppEvent[]>([]);
  const [calendars, setCalendars] = useState<CalendarInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<ViewMode>('month');

  // カレンダー一覧を保持するrefで、クロージャの古い値問題を回避
  const calendarsRef = useRef<CalendarInfo[]>([]);
  calendarsRef.current = calendars;

  const toggleCalendarVisibility = useCallback((calendarId: string) => {
    setCalendars(prev =>
      prev.map(c =>
        c.id === calendarId ? { ...c, visible: !c.visible } : c
      )
    );
  }, []);

  const fetchData = useCallback(async () => {
    if (!isAuthenticated()) return;

    setLoading(true);
    setError(null);

    try {
      // カレンダー一覧を取得（初回、またはまだ空の場合）
      let currentCalendars = calendarsRef.current;
      if (currentCalendars.length === 0) {
        const calList = await getAllCalendars();
        setCalendars(calList);
        currentCalendars = calList; // 取得直後の値を直接使う
      }

      if (currentCalendars.length === 0) {
        // カレンダーが1つもない場合
        setLoading(false);
        return;
      }

      // 表示範囲を計算
      const { start, end } = getViewRange(currentDate, viewMode);

      // 表示中のカレンダーIDのみを対象
      const visibleIds = currentCalendars.filter(c => c.visible).map(c => c.id);
      if (visibleIds.length === 0) {
        setEvents([]);
        setLoading(false);
        return;
      }

      // イベント取得
      const fetchedEvents = await getEventsForRange(start, end, visibleIds);
      setEvents(fetchedEvents);
    } catch (err) {
      setError(err instanceof Error ? err.message : '予定の取得に失敗しました');
    } finally {
      setLoading(false);
    }
  // calendarsRefを使うため、calendarsへの依存を外す
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentDate, viewMode]);

  const refresh = useCallback(() => {
    // リフレッシュ時はカレンダー一覧も再取得
    calendarsRef.current = [];
    setCalendars([]);
    fetchData();
  }, [fetchData]);

  // カレンダー表示/非表示の切替時にイベントを再取得
  useEffect(() => {
    if (calendars.length > 0) {
      fetchData();
    }
  }, [calendars, fetchData]);

  // 日付・ビューモード変更時にイベントを再取得
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return {
    events,
    calendars,
    loading,
    error,
    currentDate,
    viewMode,
    setCurrentDate,
    setViewMode,
    toggleCalendarVisibility,
    refresh,
  };
}

/**
 * 月曜始まりの曜日オフセットを取得する。
 * 月曜=0, 火曜=1, ... 日曜=6
 */
function getMondayBasedDay(date: Date): number {
  return (date.getDay() + 6) % 7;
}

/**
 * ビューモードと基準日から表示範囲を計算する（月曜始まり）。
 */
function getViewRange(
  date: Date,
  mode: ViewMode,
): { start: Date; end: Date } {
  const y = date.getFullYear();
  const m = date.getMonth();
  const d = date.getDate();

  switch (mode) {
    case 'year': {
      const start = new Date(y, 0, 1);
      const end = new Date(y, 11, 31, 23, 59, 59, 999);
      return { start, end };
    }
    case 'month': {
      // 月初の週の月曜 ～ 月末の週の日曜
      const firstDay = new Date(y, m, 1);
      const lastDay = new Date(y, m + 1, 0);
      const start = new Date(firstDay);
      start.setDate(start.getDate() - getMondayBasedDay(firstDay));
      const end = new Date(lastDay);
      end.setDate(end.getDate() + (6 - getMondayBasedDay(lastDay)));
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }
    case 'week': {
      // 月曜始まりの週
      const mondayOffset = getMondayBasedDay(new Date(y, m, d));
      const start = new Date(y, m, d - mondayOffset);
      const end = new Date(y, m, d - mondayOffset + 6, 23, 59, 59, 999);
      return { start, end };
    }
    case 'day': {
      const start = new Date(y, m, d);
      const end = new Date(y, m, d, 23, 59, 59, 999);
      return { start, end };
    }
  }
}
