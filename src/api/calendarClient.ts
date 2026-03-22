/**
 * MyCalendar - Google Calendar API クライアント
 * 
 * 直近1年分のイベント取得、およびイベントの追加・編集を行う。
 * Calendar APIを直接RESTで呼び出す（gapi不使用、軽量化のため）。
 */

import type { AppEvent, CalendarInfo } from '../data/types';
import { getAccessToken, silentRefresh } from '../auth/GoogleAuth';

const BASE_URL = 'https://www.googleapis.com/calendar/v3';

/**
 * 認証ヘッダー付きfetchラッパー
 */
async function authFetch(
  url: string,
  options: RequestInit = {},
  isRetry: boolean = false
): Promise<Response> {
  const token = getAccessToken();
  if (!token) {
    throw new Error('Not authenticated');
  }
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000); // 10秒タイムアウト

  try {
    const res = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      if (res.status === 401 && !isRetry) {
        console.log('Calendar API 401: Attempting silent refresh...');
        const success = await silentRefresh();
        if (success) {
          return authFetch(url, options, true);
        }
      }
      const errBody = await res.text();
      throw new Error(`Calendar API error (${res.status}): ${errBody}`);
    }

    return res;
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

/**
 * ユーザーのカレンダー一覧を取得する。
 */
export async function fetchCalendarList(): Promise<CalendarInfo[]> {
  const calendars: CalendarInfo[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      minAccessRole: 'reader',
      showHidden: 'false',
    });
    if (pageToken) params.set('pageToken', pageToken);

    const res = await authFetch(`${BASE_URL}/users/me/calendarList?${params}`);
    const data = await res.json();

    for (const item of data.items || []) {
      calendars.push({
        id: item.id,
        name: item.summary || '(無題)',
        color: item.backgroundColor || '#4285f4',
        visible: true,
      });
    }

    pageToken = data.nextPageToken;
  } while (pageToken);

  return calendars;
}

/**
 * 指定期間のイベントを全カレンダーから取得する。
 * 
 * @param calendarIds 取得対象のカレンダーID配列
 * @param timeMin 開始日時
 * @param timeMax 終了日時
 */
export async function fetchEvents(
  calendarIds: string[],
  timeMin: Date,
  timeMax: Date,
): Promise<AppEvent[]> {
  const promises = calendarIds.map(id =>
    fetchCalendarEvents(id, timeMin, timeMax)
  );

  const results = await Promise.allSettled(promises);
  const allEvents: AppEvent[] = [];

  for (const result of results) {
    if (result.status === 'fulfilled') {
      allEvents.push(...result.value);
    } else {
      console.warn('Calendar fetch error:', result.reason);
    }
  }

  return allEvents;
}

/**
 * 単一カレンダーからイベントを取得する（ページネーション対応）。
 */
async function fetchCalendarEvents(
  calendarId: string,
  timeMin: Date,
  timeMax: Date,
): Promise<AppEvent[]> {
  const events: AppEvent[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      maxResults: '2500',
      singleEvents: 'true',
      orderBy: 'startTime',
      showDeleted: 'true',
    });
    if (pageToken) params.set('pageToken', pageToken);

    const encodedCalId = encodeURIComponent(calendarId);
    const res = await authFetch(`${BASE_URL}/calendars/${encodedCalId}/events?${params}`);
    const data = await res.json();

    for (const item of data.items || []) {
      const event = convertApiEvent(item, calendarId);
      if (event) events.push(event);
    }

    pageToken = data.nextPageToken;
  } while (pageToken);

  return events;
}

/**
 * キーワードで過去/未来のイベントを全カレンダーから検索する。
 *
 * @param calendarIds 検索対象のカレンダーID配列
 * @param query 検索キーワード
 */
export async function searchEvents(
  calendarIds: string[],
  query: string,
): Promise<AppEvent[]> {
  const promises = calendarIds.map(id =>
    searchCalendarEvents(id, query)
  );

  const results = await Promise.allSettled(promises);
  const allEvents: AppEvent[] = [];

  for (const result of results) {
    if (result.status === 'fulfilled') {
      allEvents.push(...result.value);
    } else {
      console.warn('Calendar search error:', result.reason);
    }
  }

  // 全カレンダーの検索結果を合わせて開始日時の降順にソート（新しいものが上）
  allEvents.sort((a, b) => b.start.getTime() - a.start.getTime());

  return allEvents;
}

/**
 * 単一カレンダーからキーワード検索でイベントを取得する。
 */
async function searchCalendarEvents(
  calendarId: string,
  query: string,
): Promise<AppEvent[]> {
  const events: AppEvent[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      q: query,
      maxResults: '500', // 一度の取得件数を制限
      singleEvents: 'true',
      orderBy: 'startTime', // start time ascending (global sort handled in caller)
      showDeleted: 'true',
    });
    if (pageToken) params.set('pageToken', pageToken);

    const encodedCalId = encodeURIComponent(calendarId);
    const res = await authFetch(`${BASE_URL}/calendars/${encodedCalId}/events?${params}`);
    const data = await res.json();

    for (const item of data.items || []) {
      const event = convertApiEvent(item, calendarId);
      if (event) events.push(event);
    }

    pageToken = data.nextPageToken;
  } while (pageToken);

  return events;
}

/**
 * 新規イベントを追加する。
 */
export async function createEvent(
  calendarId: string,
  event: {
    title: string;
    description?: string;
    location?: string;
    start: Date;
    end: Date;
    isAllDay: boolean;
  },
): Promise<AppEvent> {
  const body: Record<string, unknown> = {
    summary: event.title,
    description: event.description || '',
    location: event.location || '',
  };

  if (event.isAllDay) {
    // Google Calendar API: All-day events need 'date' as YYYY-MM-DD.
    // Also, the 'end' date is EXCLUSIVE, so it must be 1 day after the actual end day.
    body.start = { date: formatDate(event.start) };
    const exclusiveEnd = new Date(event.end.getTime());
    exclusiveEnd.setDate(exclusiveEnd.getDate() + 1);
    body.end = { date: formatDate(exclusiveEnd) };
  } else {
    body.start = { dateTime: event.start.toISOString() };
    body.end = { dateTime: event.end.toISOString() };
  }

  const encodedCalId = encodeURIComponent(calendarId);
  const res = await authFetch(`${BASE_URL}/calendars/${encodedCalId}/events`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

  const created = await res.json();
  return convertApiEvent(created, calendarId)!;
}

/**
 * 既存イベントを更新する。
 */
export async function updateEvent(
  calendarId: string,
  eventId: string,
  updates: {
    title?: string;
    description?: string;
    location?: string;
    start?: Date;
    end?: Date;
    isAllDay?: boolean;
  },
): Promise<AppEvent> {
  const body: Record<string, unknown> = {};
  if (updates.title !== undefined) body.summary = updates.title;
  if (updates.description !== undefined) body.description = updates.description;
  if (updates.location !== undefined) body.location = updates.location;

  if (updates.start && updates.end) {
    if (updates.isAllDay) {
      body.start = { date: formatDate(updates.start) };
      const exclusiveEnd = new Date(updates.end.getTime());
      exclusiveEnd.setDate(exclusiveEnd.getDate() + 1);
      body.end = { date: formatDate(exclusiveEnd) };
    } else {
      body.start = { dateTime: updates.start.toISOString() };
      body.end = { dateTime: updates.end.toISOString() };
    }
  }

  const encodedCalId = encodeURIComponent(calendarId);
  const encodedEventId = encodeURIComponent(eventId);
  const res = await authFetch(
    `${BASE_URL}/calendars/${encodedCalId}/events/${encodedEventId}`,
    {
      method: 'PATCH',
      body: JSON.stringify(body),
    },
  );

  const updated = await res.json();
  return convertApiEvent(updated, calendarId)!;
}

/**
 * イベントを削除する。
 */
export async function deleteEvent(calendarId: string, eventId: string): Promise<void> {
  const encodedCalId = encodeURIComponent(calendarId);
  const encodedEventId = encodeURIComponent(eventId);
  try {
    await authFetch(
      `${BASE_URL}/calendars/${encodedCalId}/events/${encodedEventId}`,
      { method: 'DELETE' },
    );
  } catch (err: any) {
    if (err.message && err.message.includes('410')) {
      console.log('Event is already deleted on server (410). Treating as success.');
      return;
    }
    throw err;
  }
}

// --- 内部ヘルパー ---

/**
 * Google Calendar APIのイベントcolorId → 実際のhex色マッピング。
 * https://developers.google.com/calendar/api/v3/reference/colors/get
 * これらはGoogleが定義した固定の11色。
 */
const EVENT_COLORS: Record<string, string> = {
  '1':  '#7986cb', // ラベンダー
  '2':  '#33b679', // セージ
  '3':  '#8e24aa', // ブドウ
  '4':  '#e67c73', // フラミンゴ
  '5':  '#f6bf26', // バナナ
  '6':  '#f4511e', // ミカン
  '7':  '#039be5', // ピーコック
  '8':  '#616161', // グラファイト
  '9':  '#3f51b5', // ブルーベリー
  '10': '#0b8043', // バジル
  '11': '#d50000', // トマト
};

function convertApiEvent(item: any, calendarId: string): AppEvent | null {
  if (item.status === 'cancelled') {
    return {
      id: item.id,
      calendarId,
      title: '',
      description: '',
      location: '',
      start: new Date(0),
      end: new Date(0),
      isAllDay: false,
      source: 'api',
      eventColor: null,
      status: 'cancelled',
    };
  }

  const isAllDay = !!(item.start?.date);
  const startStr = isAllDay ? item.start.date : item.start?.dateTime;
  const endStr = isAllDay ? item.end?.date : item.end?.dateTime;

  if (!startStr) return null;

  // イベント個別の色を解決（colorIdがあればマッピング、なければnull）
  let eventColor: string | null = null;
  if (item.colorId && EVENT_COLORS[item.colorId]) {
    eventColor = EVENT_COLORS[item.colorId];
  }

  const startDate = new Date(startStr);
  let endDate = new Date(endStr || startStr);

  // Google Calendar APIのAll-Dayイベントは、endが「翌日の0時(exclusive)」で返ってくる。
  // MyCalendar内の表示ロジック（isAllDay時の日付比較など）を破綻させないため、
  // 終了時刻から1ミリ秒引いて「当日の23:59:59.999」扱い（inclusive）に補正する。
  if (isAllDay && endStr) {
    endDate.setTime(endDate.getTime() - 1);
  }

  return {
    id: item.id,
    calendarId,
    title: item.summary || '(無題)',
    description: item.description || '',
    location: item.location || '',
    start: startDate,
    end: endDate,
    isAllDay,
    source: 'api',
    eventColor,
  };
}

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
