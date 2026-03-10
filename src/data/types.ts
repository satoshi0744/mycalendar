/**
 * MyCalendar - 共通型定義
 */

/** アプリ内で統一的に扱う予定データ */
export interface AppEvent {
  id: string;
  calendarId: string;
  title: string;
  description: string;
  location: string;
  start: Date;
  end: Date;
  isAllDay: boolean;
  source: "api" | "archive";
  /** イベント個別に設定された色（未設定ならnull、カレンダーの色を使う） */
  eventColor: string | null;
}

/** カレンダー情報 */
export interface CalendarInfo {
  id: string;
  name: string;
  color: string;
  visible: boolean;
}

/** Driveアーカイブファイルの型 */
export interface ArchiveFile {
  exportedAt: string;
  year: number;
  calendars: Array<{
    id: string;
    name: string;
    color: string;
  }>;
  events: Array<{
    id: string;
    calendarId: string;
    title: string;
    description: string;
    location: string;
    start: string;
    end: string;
    isAllDay: boolean;
    eventColor?: string | null;
  }>;
}

/** ビューモード */
export type ViewMode = 'year' | 'month' | 'week' | 'day';

/** 認証状態 */
export interface AuthState {
  isSignedIn: boolean;
  accessToken: string | null;
  userName: string | null;
  userEmail: string | null;
}
