/**
 * MyCalendar - データ統合・正規化リポジトリ
 * 
 * Calendar API と Driveアーカイブの2つのデータソースを
 * 統合・重複排除・ソートして返す中核ロジック。
 * 
 * 設計:
 *   - 直近1年分 → Calendar API からリアルタイム取得
 *   - 1年以上前 → GASで抽出済みの Google Drive アーカイブ（JSON）から取得
 *   - 両方の期間にまたがる場合は、両ソースから取得してマージ
 */

import type { AppEvent, CalendarInfo } from './types';
import { fetchEvents, fetchCalendarList } from '../api/calendarClient';
import { fetchArchivesForYears } from '../api/driveClient';

/** アーカイブ境界日（この日より前はアーカイブから取得） */
function getArchiveBoundary(): Date {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  d.setMonth(0, 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * 指定期間のイベントを取得する。
 * 期間に応じてAPI・アーカイブ・両方のソースから自動的にフェッチし、
 * マージして返す。
 * 
 * @param timeMin 表示期間の開始
 * @param timeMax 表示期間の終了
 * @param calendarIds 取得対象のカレンダーID配列
 */
export async function getEventsForRange(
  timeMin: Date,
  timeMax: Date,
  calendarIds: string[],
): Promise<AppEvent[]> {
  const boundary = getArchiveBoundary();

  const needsApi = timeMax > boundary;
  const needsArchive = timeMin < boundary;

  const fetchPromises: Promise<AppEvent[]>[] = [];

  // 1. API から取得（直近1年分）
  if (needsApi) {
    const apiMin = timeMin > boundary ? timeMin : boundary;
    fetchPromises.push(
      fetchEvents(calendarIds, apiMin, timeMax).catch(err => {
        console.warn('Calendar API fetch failed:', err);
        return [] as AppEvent[];
      })
    );
  }

  // 2. アーカイブから取得（1年以上前）
  if (needsArchive) {
    const archiveMax = timeMax < boundary ? timeMax : boundary;
    const startYear = timeMin.getFullYear();
    const endYear = archiveMax.getFullYear();
    const years: number[] = [];
    for (let y = startYear; y <= endYear; y++) {
      years.push(y);
    }

    fetchPromises.push(
      fetchArchivesForYears(years)
        .then(result => {
          // アーカイブのイベントを表示期間内 & 対象カレンダーのみフィルタ
          return result.events.filter(e => {
            const inRange = e.start >= timeMin && e.start <= archiveMax;
            const calendarMatch = calendarIds.length === 0 || calendarIds.includes(e.calendarId);
            return inRange && calendarMatch;
          });
        })
        .catch(err => {
          console.warn('Archive fetch failed:', err);
          return [] as AppEvent[];
        })
    );
  }

  // 3. 全ソースの結果を待ち、マージ
  const results = await Promise.all(fetchPromises);
  const flatEvents = results.flat();

  // 4. 重複排除（IDベース、APIの結果を優先）
  return deduplicateAndSort(flatEvents);
}

/**
 * カレンダー一覧を取得する。
 */
export async function getAllCalendars(): Promise<CalendarInfo[]> {
  try {
    return await fetchCalendarList();
  } catch (error) {
    console.warn('Failed to fetch calendar list:', error);
    return [];
  }
}

/**
 * イベントを重複排除し、開始日時でソートする。
 * 同一IDのイベントが複数ある場合、APIの結果（source: 'api'）を優先する。
 */
function deduplicateAndSort(events: AppEvent[]): AppEvent[] {
  const map = new Map<string, AppEvent>();

  // アーカイブを先に登録し、APIのデータで上書きすることで API優先を実現
  const archiveEvents = events.filter(e => e.source === 'archive');
  const apiEvents = events.filter(e => e.source === 'api');

  for (const e of archiveEvents) {
    map.set(`${e.calendarId}__${e.id}`, e);
  }
  for (const e of apiEvents) {
    map.set(`${e.calendarId}__${e.id}`, e);
  }

  return [...map.values()].sort(
    (a, b) => a.start.getTime() - b.start.getTime()
  );
}
