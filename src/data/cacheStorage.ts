/**
 * MyCalendar - キャッシュストレージ (LocalStorage / IndexedDB)
 * 
 * 取得したアーカイブデータをローカルに保存し、
 * オフライン時や起動時の高速表示に使用する。
 * とりあえす LocalStorage で実装し、データ量が増えたら IndexedDB に移行を検討。
 */

import type { AppEvent } from './types';

const CACHE_KEY_PREFIX = 'mc_archive_';

/** 指定した年のイベントをキャッシュに保存 */
export function saveArchiveToCache(year: number, events: AppEvent[]): void {
  try {
    const key = `${CACHE_KEY_PREFIX}${year}`;
    // Dateオブジェクトをシリアライズ可能にするため文字列化
    localStorage.setItem(key, JSON.stringify(events));
  } catch (e) {
    console.warn(`Failed to save cache for ${year}:`, e);
  }
}

/** 指定した年のイベントをキャッシュから取得 */
export function getArchiveFromCache(year: number): AppEvent[] | null {
  try {
    const key = `${CACHE_KEY_PREFIX}${year}`;
    const data = localStorage.getItem(key);
    if (!data) return null;
    
    const parsed = JSON.parse(data) as any[];
    if (!Array.isArray(parsed)) return null;

    return parsed.map(e => ({
      ...e,
      start: e.start ? new Date(e.start) : new Date(),
      end: e.end ? new Date(e.end) : new Date(),
    })).filter(e => !isNaN(e.start.getTime())); // 無効な日付を除外
  } catch (e) {
    console.warn(`Failed to load cache for ${year}:`, e);
    return null;
  }
}

/** 指定した期間（年単位）のキャッシュをまとめて取得 */
export function getArchivesFromCache(years: number[]): AppEvent[] {
  const allEvents: AppEvent[] = [];
  for (const year of years) {
    const cached = getArchiveFromCache(year);
    if (cached) {
      allEvents.push(...cached);
    }
  }
  return allEvents;
}

/**
 * 渡されたID（calendarId__id の形式）を持つイベントを、
 * 保持しているすべての年のキャッシュから削除します。
 */
export function removeEventsFromAllCaches(idKeys: string[]): void {
  if (idKeys.length === 0) return;
  const idSet = new Set(idKeys);
  try {
    const currentYear = new Date().getFullYear();
    // 過去11年〜未来1年程度のキャッシュを走査して削除（計12年分）
    const years = Array.from({length: 12}, (_, i) => currentYear + 1 - i);
    for (const year of years) {
      const existing = getArchiveFromCache(year);
      if (existing) {
        const filtered = existing.filter(e => !idSet.has(`${e.calendarId}__${e.id}`));
        if (filtered.length !== existing.length) {
          saveArchiveToCache(year, filtered);
        }
      }
    }
  } catch(e) { console.warn('Failed to remove events from all caches', e); }
}

/** 
 * イベントを既存のキャッシュにマージ（差分更新・完全同期）する。
 * calendarIds が指定された場合、そのカレンダーの syncRange 内にある既存データは
 * 一旦すべて破棄し、newEvents で置き換える（1対1の比較・完全同期）。
 */
export function mergeArchiveToCache(
  year: number,
  newEvents: AppEvent[],
  syncRange?: { min: Date; max: Date },
  calendarIds?: string[]
): void {
  try {
    const existing = getArchiveFromCache(year) || [];
    const map = new Map<string, AppEvent>();
    
    // カレンダーIDをセット化（検索用）
    const targetCalSet = calendarIds ? new Set(calendarIds) : null;

    // 既存データを登録
    for (const e of existing) {
      // 同期範囲内であり、かつ同期対象のカレンダーであれば、一旦除外
      // これにより、Gカレンダー側で完全に消えたイベントがキャッシュからも消える（完全同期）
      if (syncRange && targetCalSet && targetCalSet.has(e.calendarId)) {
        // 重なり判定: イベントの終了が範囲の開始以降 ＆ イベントの開始が範囲の終了以前
        if (e.end >= syncRange.min && e.start <= syncRange.max) {
          continue;
        }
      }
      map.set(`${e.calendarId}__${e.id}`, e);
    }

    // 新データで上書き（または削除マークに従い削除）
    for (const e of newEvents) {
      const idKey = `${e.calendarId}__${e.id}`;
      if (e.status === 'cancelled') {
        map.delete(idKey);
      } else {
        map.set(idKey, e);
      }
    }
    
    const merged = Array.from(map.values())
      .filter(e => e.status !== 'cancelled')
      .sort((a, b) => a.start.getTime() - b.start.getTime());
    saveArchiveToCache(year, merged);
  } catch (e) {
    console.warn(`Failed to merge cache for ${year}:`, e);
  }
}
