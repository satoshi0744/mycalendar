/**
 * MyCalendar - Google Drive API クライアント（読み取り専用）
 * 
 * Googleドライブの calendar_archives フォルダから
 * 年ごとのアーカイブJSONファイルを取得する。
 */

import type { AppEvent, ArchiveFile, CalendarInfo } from '../data/types';
import { getAccessToken, silentRefresh } from '../auth/GoogleAuth';

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const ARCHIVE_FOLDER_NAME = 'calendar_archives';

/**
 * 認証ヘッダー付きfetchラッパー
 */
async function authFetch(url: string, isRetry: boolean = false): Promise<Response> {
  const token = getAccessToken();
  if (!token) {
    throw new Error('Not authenticated');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000); // 10秒タイムアウト

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      if (res.status === 401 && !isRetry) {
        console.log('Drive API 401: Attempting silent refresh...');
        const success = await silentRefresh();
        if (success) {
          return authFetch(url, true);
        }
      }
      throw new Error(`Drive API error (${res.status}): ${await res.text()}`);
    }

    return res;
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

/**
 * calendar_archives フォルダのIDを取得する。
 * 見つからない場合はnullを返す。
 */
async function findArchiveFolderId(): Promise<string | null> {
  const query = `name='${ARCHIVE_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const params = new URLSearchParams({
    q: query,
    fields: 'files(id,name)',
    spaces: 'drive',
  });

  const res = await authFetch(`${DRIVE_API_BASE}/files?${params}`);
  const data = await res.json();

  if (data.files && data.files.length > 0) {
    return data.files[0].id;
  }
  return null;
}

/**
 * 指定年のアーカイブJSONをDriveから取得する。
 * ファイルが存在しない場合は空の結果を返す（エラーにしない）。
 * 
 * @param year 取得対象の年（例: 2024）
 * @returns イベント配列とカレンダー情報のタプル
 */
export async function fetchArchiveForYear(
  year: number,
): Promise<{ events: AppEvent[]; calendars: CalendarInfo[] }> {
  try {
    const folderId = await findArchiveFolderId();
    if (!folderId) {
      console.log('calendar_archives フォルダが見つかりません');
      return { events: [], calendars: [] };
    }

    // フォルダ内の対象年のJSONファイルを検索
    const fileName = `${year}.json`;
    const query = `'${folderId}' in parents and name='${fileName}' and trashed=false`;
    const params = new URLSearchParams({
      q: query,
      fields: 'files(id,name)',
    });

    const res = await authFetch(`${DRIVE_API_BASE}/files?${params}`);
    const data = await res.json();

    if (!data.files || data.files.length === 0) {
      console.log(`${fileName} が見つかりません（データなし）`);
      return { events: [], calendars: [] };
    }

    // ファイルの内容をダウンロード
    const fileId = data.files[0].id;
    const contentRes = await authFetch(`${DRIVE_API_BASE}/files/${fileId}?alt=media`);
    const archive: ArchiveFile = await contentRes.json();

    return parseArchive(archive);
  } catch (error) {
    console.warn(`${year}年のアーカイブ取得に失敗:`, error);
    return { events: [], calendars: [] };
  }
}

/**
 * 複数年分のアーカイブを一括取得する。
 * 
 * @param years 取得対象の年の配列
 */
export async function fetchArchivesForYears(
  years: number[],
): Promise<{ events: AppEvent[]; calendars: CalendarInfo[] }> {
  const promises = years.map(year => fetchArchiveForYear(year));
  const results = await Promise.allSettled(promises);

  const allEvents: AppEvent[] = [];
  const calendarMap = new Map<string, CalendarInfo>();

  for (const result of results) {
    if (result.status === 'fulfilled') {
      allEvents.push(...result.value.events);
      for (const cal of result.value.calendars) {
        calendarMap.set(cal.id, cal);
      }
    }
  }

  return {
    events: allEvents,
    calendars: [...calendarMap.values()],
  };
}

// --- 内部ヘルパー ---

/**
 * ArchiveFile（JSON）をAppEvent配列に変換する。
 */
function parseArchive(archive: ArchiveFile): {
  events: AppEvent[];
  calendars: CalendarInfo[];
} {
  const events: AppEvent[] = archive.events.map(e => ({
    id: e.id,
    calendarId: e.calendarId,
    title: e.title,
    description: e.description || '',
    location: e.location || '',
    start: new Date(e.start),
    end: new Date(e.end),
    isAllDay: e.isAllDay,
    source: 'archive' as const,
    eventColor: e.eventColor || null,
  }));

  const calendars: CalendarInfo[] = archive.calendars.map(c => ({
    id: c.id,
    name: c.name,
    color: c.color,
    visible: true,
  }));

  return { events, calendars };
}
