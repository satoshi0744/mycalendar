/**
 * MyCalendar - データ統合・正規化リポジトリ
 * 
 * Calendar API と Driveアーカイブ (およびローカルキャッシュ) を
 * 統合・重複排除・ソートして返す中核ロジック。
 * 
 * 設計:
 *   - 直近1年分 → Calendar API からリアルタイム取得
 *   - それ以前（または最新APIから漏れる分） → ローカルキャッシュまたは Google Drive アーカイブ
 *   - Drive-First: まずキャッシュを探し、バックグラウンドまたは必要に応じて Drive から落とす
 */

import type { AppEvent, CalendarInfo } from './types';
import { fetchEvents, fetchCalendarList, searchEvents as searchApiEvents } from '../api/calendarClient';
import { fetchArchivesForYears } from '../api/driveClient';
import { getArchivesFromCache, saveArchiveToCache, mergeArchiveToCache, removeEventsFromAllCaches } from './cacheStorage';

/** アーカイブとAPIの境界日（GASのアーカイブ仕様に合わせる: 今年の1年前の1月1日） */
function getApiBoundary(): Date {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  d.setMonth(0, 1);
  d.setHours(0, 0, 0, 0);
  return d;
}


/**
 * 指定期間のイベントを取得する。
 */
export async function getEventsForRange(
  timeMin: Date,
  timeMax: Date,
  calendarIds: string[],
): Promise<AppEvent[]> {
  // 全ての年をアーカイブ/キャッシュの対象にする
  const startYear = timeMin.getFullYear();
  const endYear = timeMax.getFullYear();
  const archiveYears: number[] = [];
  for (let y = startYear; y <= endYear; y++) {
    archiveYears.push(y);
  }

  // APIが必要な期間か判定
  const boundary = getApiBoundary();
  const needsApi = timeMax > boundary;

  const fetchPromises: Promise<AppEvent[]>[] = [];

  // 1. API から取得（境界より新しい期間）
  if (needsApi) {
    const apiMin = timeMin > boundary ? timeMin : boundary;
    const apiPromise = fetchEvents(calendarIds, apiMin, timeMax).then(events => {
      // 1. キャンセルされたイベントを抽出し、全年のキャッシュからパージする
      const cancelledIds = events.filter(e => e.status === 'cancelled').map(e => `${e.calendarId}__${e.id}`);
      if (cancelledIds.length > 0) {
        removeEventsFromAllCaches(cancelledIds);
      }

      // 取得した直近データもローカルの年別キャッシュに保存（マージ）する
      // 重要: 取得範囲内の「すべての年」に対してマージ処理を走らせることで、
      // Google側で削除された予定（APIから返らなくなった予定）もキャッシュから消えるようにする。
      const eventsByYear = new Map<number, AppEvent[]>();
      for (const e of events) {
        if (e.status === 'cancelled') continue; // パージ済みなので年別マージには渡さない
        const y = e.start.getFullYear();
        if (!eventsByYear.has(y)) eventsByYear.set(y, []);
        eventsByYear.get(y)!.push(e);
      }
      
      const startY = apiMin.getFullYear();
      const endY = timeMax.getFullYear();
      for (let y = startY; y <= endY; y++) {
        const yearEvents = eventsByYear.get(y) || [];
        mergeArchiveToCache(y, yearEvents, { min: apiMin, max: timeMax }, calendarIds);
      }
      return events;
    });
    fetchPromises.push(apiPromise);
  }

  // 2. アーカイブ/キャッシュから取得
  if (archiveYears.length > 0) {
    // まずはキャッシュから取得（即時）
    // キャッシュ由来であることを示すフラグを付与
    const cachedEvents = getArchivesFromCache(archiveYears).map(e => ({ ...e, isFromCache: true }));
    
    // キャッシュがない年があるか確認
    const cachedYears = new Set(cachedEvents.map(e => e.start.getFullYear()));
    const missingYears = archiveYears.filter(y => !cachedYears.has(y));

    if (missingYears.length > 0) {
      // 足りない分は Drive から取得
      const drivePromise = fetchArchivesForYears(missingYears).then(result => {
        // 取得したデータは年ごとにキャッシュに保存
        const eventsByYear = new Map<number, AppEvent[]>();
        for (const e of result.events) {
          const y = e.start.getFullYear();
          if (!eventsByYear.has(y)) eventsByYear.set(y, []);
          eventsByYear.get(y)!.push(e);
        }
        for (const year of missingYears) {
          saveArchiveToCache(year, eventsByYear.get(year) || []);
        }
        // Driveから取得したものもキャッシュ由来扱い（初回以降はキャッシュに乗るため）
        return result.events.map(e => ({ ...e, isFromCache: true }));
      }).catch(err => {
        console.warn('Drive fetch error:', err);
        return [] as AppEvent[];
      });
      
      fetchPromises.push(drivePromise);
    }

    // すでにあるキャッシュは即座に結果に含める
    if (cachedEvents.length > 0) {
      fetchPromises.push(Promise.resolve(cachedEvents));
    }
  }

  try {
    const results = await Promise.all(fetchPromises);
    const flatEvents = results.flat();

    // 表示期間内 & 対象カレンダーのみフィルタ（アーカイブとAPIが混ざっているため）
    const filteredEvents = flatEvents.filter(e => {
      const inRange = e.start >= timeMin && e.start <= timeMax;
      const calendarMatch = calendarIds.length === 0 || calendarIds.includes(e.calendarId);
      return inRange && calendarMatch;
    });

    // API取得範囲を特定して、その範囲のキャッシュデータは信用しない（Source of Truth）
    const apiRange = needsApi ? { 
      min: timeMin > boundary ? timeMin : boundary, 
      max: timeMax 
    } : undefined;

    return deduplicateAndSort(filteredEvents, apiRange);
  } catch (err) {
    console.warn('getEventsForRange fallback to local only due to error:', err);
    // 全体のフェッチが失敗（通信エラー等）した場合、すでに取得済みのキャッシュ分だけでも返す
    const cachedEvents = getArchivesFromCache(archiveYears).map(e => ({ ...e, isFromCache: true }));
    return deduplicateAndSort(cachedEvents.filter(e => {
      const inRange = e.start >= timeMin && e.start <= timeMax;
      const calendarMatch = calendarIds.length === 0 || calendarIds.includes(e.calendarId);
      return inRange && calendarMatch;
    }));
  }
}

/**
 * カレンダー一覧を取得する。
 */
export async function getAllCalendars(): Promise<CalendarInfo[]> {
  return await fetchCalendarList();
}

/**
 * 全期間（API + 12年分キャッシュ）からイベントを検索する。
 */
export async function searchEventsAcrossAll(
  calendarIds: string[],
  query: string,
): Promise<AppEvent[]> {
  const currentYear = new Date().getFullYear();
  const archiveYears = Array.from({ length: 12 }, (_, i) => currentYear - i);

  const searchPromises: Promise<AppEvent[]>[] = [];

  // 1. API 検索（オンライン時のみ成功する）
  searchPromises.push(searchApiEvents(calendarIds, query).catch(() => []));

  // 2. ローカルキャッシュ（12年分）を検索（これもキャッシュ扱い）
  const cacheSearchPromise = (async () => {
    const allCached = getArchivesFromCache(archiveYears).map(e => ({ ...e, isFromCache: true }));
    const lowerQuery = query.toLowerCase();
    return allCached.filter(e => 
      (e.title?.toLowerCase().includes(lowerQuery) || 
       e.description?.toLowerCase().includes(lowerQuery) ||
       e.location?.toLowerCase().includes(lowerQuery)) &&
      (calendarIds.length === 0 || calendarIds.includes(e.calendarId))
    );
  })();
  searchPromises.push(cacheSearchPromise);

  const results = await Promise.all(searchPromises);
  return deduplicateAndSort(results.flat());
}

/**
 * イベントを重複排除し、開始日時でソートする。
 * apiRange が指定された場合、その範囲内のキャッシュ(isFromCache)データは無視する（APIを絶対の正とする）。
 */
function deduplicateAndSort(events: AppEvent[], apiRange?: { min: Date; max: Date }): AppEvent[] {
  const map = new Map<string, AppEvent>();

  for (const e of events) {
    if (e.status === 'cancelled') continue;

    // キャッシュ由来のデータで、かつAPI取得範囲内のものはスキップする
    // これにより、Gカレンダー側で削除された予定がキャッシュから復活するのを防ぐ
    // 重なり判定: イベントの終了が範囲の開始以降 ＆ イベントの開始が範囲の終了以前
    if (e.isFromCache && apiRange && e.end >= apiRange.min && e.start <= apiRange.max) {
      continue;
    }
    
    const idKey = `${e.calendarId}__${e.id}`;
    const existing = map.get(idKey);

    // 重複時は API (isFromCache=false/undefined) を優先
    if (!existing || (!e.isFromCache && existing.isFromCache)) {
      map.set(idKey, e);
    }
  }

  return [...map.values()]
    .sort((a, b) => (a.start?.getTime() || 0) - (b.start?.getTime() || 0));
}
