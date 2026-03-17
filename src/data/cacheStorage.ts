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
 * イベントを既存のキャッシュにマージ（差分更新）する。
 * カレンダー閲覧等の部分的な取得でキャッシュを上書きしないための安全策。
 */
export function mergeArchiveToCache(year: number, newEvents: AppEvent[]): void {
  try {
    const existing = getArchiveFromCache(year) || [];
    const map = new Map<string, AppEvent>();
    
    // 既存データを登録
    for (const e of existing) {
      map.set(`${e.calendarId}__${e.id}`, e);
    }
    // 新データで上書き
    for (const e of newEvents) {
      map.set(`${e.calendarId}__${e.id}`, e);
    }
    
    const merged = Array.from(map.values()).sort((a, b) => a.start.getTime() - b.start.getTime());
    saveArchiveToCache(year, merged);
  } catch (e) {
    console.warn(`Failed to merge cache for ${year}:`, e);
  }
}
