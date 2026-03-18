import { useState, useEffect, useCallback, useRef } from 'react';
import localforage from 'localforage';
import type { AppEvent, CalendarInfo, ViewMode } from '../data/types';
import { getEventsForRange, getAllCalendars } from '../data/eventRepository';
import { isAuthenticated, getAuthState } from '../auth/GoogleAuth';

// localforage の初期設定
localforage.config({
  name: 'MyCalendar',
  storeName: 'cache'
});

const VISIBILITY_STORAGE_KEY = 'calendar_visibility_v2';
const VISIBILITY_SETTINGS_KEY = 'calendar_visibility_settings_persistent'; // 強固なバックアップ用
const DEFAULT_CALENDAR_KEY = 'default_calendar_id_v2';
const CALENDARS_CACHE_KEY = 'calendars_v2';
const LAST_SYNC_KEY = 'last_sync_timestamp';

/** カレンダーリストをキャッシュに保存 */
async function saveCalendarsCache(calendars: CalendarInfo[]): Promise<void> {
  try {
    await localforage.setItem(CALENDARS_CACHE_KEY, calendars);
  } catch { /* ignore */ }
}

/** カレンダーリストをキャッシュから読み込み */
async function loadCalendarsCache(): Promise<CalendarInfo[]> {
  try {
    const data = await localforage.getItem<CalendarInfo[]>(CALENDARS_CACHE_KEY);
    return data || [];
  } catch { return []; }
}

/** カレンダーの表示/非表示設定を保存 */
async function saveVisibility(calendars: CalendarInfo[]): Promise<void> {
  try {
    const map: Record<string, boolean> = {};
    for (const c of calendars) {
      map[c.id] = c.visible;
    }
    // 二重に保存して、片方が消えても復元できるようにする
    await Promise.all([
      localforage.setItem(VISIBILITY_STORAGE_KEY, map),
      localforage.setItem(VISIBILITY_SETTINGS_KEY, map)
    ]);
  } catch { /* ignore */ }
}

/** 表示/非表示設定を復元 */
async function restoreVisibility(calendars: CalendarInfo[]): Promise<CalendarInfo[]> {
  try {
    // まず標準キー、ダメならバックアップキーから読み込む
    let map = await localforage.getItem<Record<string, boolean>>(VISIBILITY_STORAGE_KEY);
    if (!map) {
      map = await localforage.getItem<Record<string, boolean>>(VISIBILITY_SETTINGS_KEY);
    }
    
    if (map) {
      return calendars.map(c => ({
        ...c,
        visible: map![c.id] !== undefined ? map![c.id] : c.visible,
      }));
    }
  } catch { /* ignore */ }
  return calendars;
}

interface UseCalendarDataReturn {
  events: AppEvent[];
  calendars: CalendarInfo[];
  loading: boolean;
  error: string | null;
  currentDate: Date;
  viewMode: ViewMode;
  defaultCalendarId: string | null;
  setCurrentDate: (date: Date) => void;
  setViewMode: (mode: ViewMode) => void;
  toggleCalendarVisibility: (calendarId: string) => void;
  setDefaultCalendar: (calendarId: string) => void;
  refresh: () => void;
  syncYearData: (force?: boolean) => Promise<void>;
  syncing: boolean;
  lastSyncTime: number | null;
}

export function useCalendarData(): UseCalendarDataReturn {
  const [events, setEvents] = useState<AppEvent[]>([]);
  const [calendars, setCalendars] = useState<CalendarInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [defaultCalendarId, setDefaultCalendarId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<number | null>(null);

  const calendarsRef = useRef<CalendarInfo[]>([]);

  // 初期読み込み: IndexedDB からキャッシュを復旧
  useEffect(() => {
    async function init() {
      const [cachedCals, storedDefault, storedSync] = await Promise.all([
        loadCalendarsCache(),
        localforage.getItem<string>(DEFAULT_CALENDAR_KEY),
        localforage.getItem<number>(LAST_SYNC_KEY)
      ]);
      
      const restoredCals = await restoreVisibility(cachedCals);
      setCalendars(restoredCals);
      calendarsRef.current = restoredCals;
      
      if (storedDefault) setDefaultCalendarId(storedDefault);
      if (storedSync) setLastSyncTime(storedSync);
    }
    init();
  }, []);

  const fetchData = useCallback(async () => {
    if (!isAuthenticated()) return;

    setLoading(true);
    setError(null);

    try {
      let currentCalendars = calendarsRef.current;
      if (currentCalendars.length === 0) {
        try {
          const calList = await getAllCalendars();
          const restored = await restoreVisibility(calList);
          setCalendars(restored);
          calendarsRef.current = restored;
          await saveCalendarsCache(restored);
          currentCalendars = restored;
        } catch (e) {
          console.warn('Network call failed, using cached calendars:', e);
          const cachedCalendars = await loadCalendarsCache();
          if (cachedCalendars.length > 0) {
            setCalendars(cachedCalendars);
            calendarsRef.current = cachedCalendars;
            currentCalendars = cachedCalendars;
          }
        }
      }

      if (currentCalendars.length === 0) {
        setLoading(false);
        return;
      }

      const { start, end } = getViewRange(currentDate, viewMode);
      const visibleIds = currentCalendars.filter(c => c.visible).map(c => c.id);
      if (visibleIds.length === 0) {
        setEvents([]);
        setLoading(false);
        return;
      }

      let fetchedEvents: AppEvent[] = [];
      try {
        fetchedEvents = await getEventsForRange(start, end, visibleIds);
      } catch (fetchErr: any) {
        if (fetchErr.status === 401 || fetchErr.status === 403 || fetchErr.message?.includes('auth')) {
          setError('AUTH_REQUIRED');
        } else {
          setError(fetchErr.message || '予定の取得に失敗しました');
        }
      }
      
      setEvents(prev => {
        const baseMap = new Map<string, AppEvent>();
        // 既存のイベントをマップに展開
        for (const e of prev) {
          baseMap.set(`${e.calendarId}__${e.id}`, e);
        }
        // 新しく取得したイベントで上書き
        for (const e of fetchedEvents) {
          baseMap.set(`${e.calendarId}__${e.id}`, e);
        }
        return Array.from(baseMap.values()).sort((a, b) => a.start.getTime() - b.start.getTime());
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : '予定の取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, [currentDate, viewMode]);

  useEffect(() => {
    if (calendars.length > 0) {
      fetchData();
    }
  }, [calendars, fetchData]);

  const toggleCalendarVisibility = useCallback(async (calendarId: string) => {
    const updated = calendarsRef.current.map(c =>
      c.id === calendarId ? { ...c, visible: !c.visible } : c
    );
    setCalendars(updated);
    calendarsRef.current = updated;
    await saveVisibility(updated);
    await saveCalendarsCache(updated);
    
    const isNowVisible = updated.find(c => c.id === calendarId)?.visible;
    if (isNowVisible) fetchData();
  }, [fetchData]);

  const setDefaultCalendar = useCallback(async (calendarId: string) => {
    setDefaultCalendarId(calendarId);
    await localforage.setItem(DEFAULT_CALENDAR_KEY, calendarId);
  }, []);

  const syncYearData = useCallback(async (force: boolean = false) => {
    const state = getAuthState();
    if (!state.isSignedIn || syncing) return;

    // 前回の同期から24時間以内ならスキップ（強制実行時以外）
    if (!force) {
      const lastSync = await localforage.getItem<number>(LAST_SYNC_KEY);
      const now = Date.now();
      if (lastSync && now - lastSync < 24 * 60 * 60 * 1000) {
        console.log('Sync skipped (last sync was less than 24h ago)');
        // スキップ時も、現在の年〜過去4年分をさっとキャッシュから舐めて state に入れる
        const currentYear = new Date().getFullYear();
        const cached = await getEventsForRange(new Date(currentYear - 4, 0, 1), new Date(currentYear, 11, 31), calendarsRef.current.map(c => c.id));
        setEvents(prev => {
          const map = new Map<string, AppEvent>();
          for (const e of prev) map.set(`${e.calendarId}__${e.id}`, e);
          for (const e of cached) map.set(`${e.calendarId}__${e.id}`, e);
          return Array.from(map.values()).sort((a, b) => a.start.getTime() - b.start.getTime());
        });
        return;
      }
    }

    setSyncing(true);
    try {
      const currentYear = new Date().getFullYear();
      // 最新2年分（今年＋昨年）を同期対象にする
      const years = Array.from({length: 2}, (_, i) => currentYear - i);

      console.log(`Starting background sync for years: ${years.join(', ')}`);
      const visibleIds = calendarsRef.current.map(c => c.id);
      
      if (visibleIds.length > 0) {
        // 各年ごとに順次取得してキャッシュを構築
        for (const year of years) {
          const start = new Date(year, 0, 1);
          const end = new Date(year, 11, 31, 23, 59, 59);
          // 内部で Drive or API から取得して mergeArchiveToCache される
          const fetched = await getEventsForRange(start, end, visibleIds);
          
          setEvents(prev => {
            const map = new Map<string, AppEvent>();
            for (const e of prev) map.set(`${e.calendarId}__${e.id}`, e);
            for (const e of fetched) map.set(`${e.calendarId}__${e.id}`, e);
            return Array.from(map.values()).sort((a, b) => a.start.getTime() - b.start.getTime());
          });
        }
      }
      
      const now = Date.now();
      await localforage.setItem(LAST_SYNC_KEY, now);
      setLastSyncTime(now);
      console.log('Background sync completed.');
    } catch (e) {
      console.warn('Background sync failed:', e);
    } finally {
      setSyncing(false);
    }
  }, [syncing]);

  const refresh = useCallback(async () => {
    const state = getAuthState();
    if (!state.isSignedIn) {
      setError('AUTH_REQUIRED');
      return;
    }
    setLoading(true);
    try {
      const calList = await getAllCalendars();
      const restored = await restoreVisibility(calList);
      calendarsRef.current = restored;
      setCalendars(restored);
      await saveCalendarsCache(restored);
    } catch (e) {
      console.warn('refresh failed:', e);
    }
    fetchData();
    syncYearData(false); // 低頻度での同期
  }, [fetchData, syncYearData]);

  return {
    events,
    calendars,
    loading,
    error,
    currentDate,
    viewMode,
    defaultCalendarId,
    setCurrentDate,
    setViewMode,
    toggleCalendarVisibility,
    setDefaultCalendar,
    refresh,
    syncYearData,
    syncing,
    lastSyncTime,
  };
}

function getMondayBasedDay(date: Date): number {
  return (date.getDay() + 6) % 7;
}

function getViewRange(date: Date, mode: ViewMode): { start: Date; end: Date } {
  const y = date.getFullYear();
  const m = date.getMonth();
  const d = date.getDate();

  switch (mode) {
    case 'year': {
      return { start: new Date(y, 0, 1), end: new Date(y, 11, 31, 23, 59, 59, 999) };
    }
    case 'month': {
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
      const mondayOffset = getMondayBasedDay(new Date(y, m, d));
      const start = new Date(y, m, d - mondayOffset);
      const end = new Date(y, m, d - mondayOffset + 6, 23, 59, 59, 999);
      return { start, end };
    }
    case 'day': {
      return { start: new Date(y, m, d), end: new Date(y, m, d, 23, 59, 59, 999) };
    }
  }
}
