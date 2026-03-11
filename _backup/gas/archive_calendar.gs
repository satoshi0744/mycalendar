/**
 * ============================================================
 * MyCalendar - GAS アーカイブスクリプト
 * ============================================================
 * 
 * 【目的】
 * Googleカレンダーから1年以上前の予定を抽出し、
 * 年ごとのJSONファイルとしてGoogleドライブに保存する。
 * 
 * 【使い方】
 * 1. Google Apps Script (https://script.google.com) で新規プロジェクトを作成
 * 2. 「サービス」から Calendar API (v3) を追加
 * 3. このコードを貼り付けて保存
 * 4. exportAllCalendars() を実行（初回は権限の承認が必要）
 * 5. Googleドライブの calendar_archives/ フォルダにJSONが生成される
 * 
 * 【定期実行の設定】
 * 方法A: setupMonthlyTrigger() を1回手動実行する（自動でトリガーが作成される）
 * 方法B: GASエディタ → トリガー → + → monthlyIncrementalExport → 月ベースのタイマー → 毎月1日
 * 
 * 【関数の使い分け】
 * - exportAllCalendars()        : 初回の全データ取得（全期間を再取得し既存JSONとマージ）
 * - monthlyIncrementalExport()  : 定期トリガー用（前月分の差分のみ取得し既存JSONに追加）
 * - exportSingleCalendar(id)    : 大量データ向け（1カレンダーずつ分割実行）
 * 
 * 【注意事項】
 * - GAS無料アカウントの実行時間制限は6分
 * - カレンダー数や予定数が非常に多い場合は exportSingleCalendar() で分割実行可能
 * ============================================================
 */

// ============================================================
// 設定
// ============================================================

/** アーカイブ保存先のドライブフォルダ名 */
const ARCHIVE_FOLDER_NAME = 'calendar_archives';

/** アーカイブ対象とする境界日（この日より前の予定を抽出） */
function getArchiveBoundaryDate() {
  const now = new Date();
  now.setFullYear(now.getFullYear() - 1);
  // 1年前の1月1日を境界とする（年単位で綺麗に区切るため）
  return new Date(now.getFullYear(), 0, 1);
}

/** 抽出対象の最古の年（これより前は処理しない） */
const OLDEST_YEAR = 2010;

// ============================================================
// メインエントリポイント
// ============================================================

/**
 * 全カレンダーの1年以上前の予定をアーカイブする（初回 or フル同期用）。
 * 全期間を再取得するが、既存のJSONファイルがあれば内容をマージし、
 * 重複排除したうえで保存する。何度実行しても安全。
 */
function exportAllCalendars() {
  console.log('=== フルアーカイブ処理を開始 ===');

  const boundary = getArchiveBoundaryDate();
  console.log(`アーカイブ境界日: ${boundary.toISOString()}`);

  // 1. 全カレンダー一覧を取得
  const calendars = fetchAllCalendars();
  console.log(`対象カレンダー数: ${calendars.length}`);

  // 2. 全カレンダーから境界日より前のイベントを取得
  const allEvents = [];
  for (const cal of calendars) {
    console.log(`処理中: ${cal.name} (${cal.id})`);
    const events = fetchEventsBeforeBoundary(cal.id, boundary);
    console.log(`  → ${events.length} 件のイベントを取得`);
    allEvents.push(...events);
  }

  console.log(`合計イベント数: ${allEvents.length}`);

  if (allEvents.length === 0) {
    console.log('アーカイブ対象のイベントがありませんでした。');
    return;
  }

  // 3. 年ごとにグループ化
  const eventsByYear = groupEventsByYear(allEvents);

  // 4. Driveのアーカイブフォルダを取得（なければ作成）
  const folder = getOrCreateArchiveFolder();

  // 5. 年ごとに既存JSONとマージして保存
  for (const [year, newEvents] of Object.entries(eventsByYear)) {
    mergeAndSaveYear(folder, parseInt(year), newEvents, calendars);
  }

  console.log('=== フルアーカイブ処理が完了しました ===');
}

// ============================================================
// 定期トリガー用エントリポイント（差分更新）
// ============================================================

/**
 * 【定期トリガー用】新たにアーカイブ対象となった期間のみ差分取得し、
 * 既存のJSONファイルに追加（マージ）する。
 * 
 * 動作:
 *   1. 現在のアーカイブ境界日を計算
 *   2. 前回の実行時のアーカイブ境界日（= 前月の境界日）を推定
 *   3. その差分期間（通常は1ヶ月分）のイベントのみAPIから取得
 *   4. 既存JSONとマージ・重複排除して保存
 * 
 * 毎月1日にトリガーで実行することを想定。
 * 安全策として、差分期間に2ヶ月のバッファを持たせ、
 * 取りこぼしを防止する。
 */
function monthlyIncrementalExport() {
  console.log('=== 差分アーカイブ処理を開始 ===');

  const boundary = getArchiveBoundaryDate();
  console.log(`現在のアーカイブ境界日: ${boundary.toISOString()}`);

  // 差分取得の開始日 = 境界日の2ヶ月前（バッファ込み）
  // 例: 境界が2025-01-01なら、2024-11-01 〜 2025-01-01 を取得
  const incrementalStart = new Date(boundary);
  incrementalStart.setMonth(incrementalStart.getMonth() - 2);
  console.log(`差分取得期間: ${incrementalStart.toISOString()} 〜 ${boundary.toISOString()}`);

  // 1. 全カレンダー一覧を取得
  const calendars = fetchAllCalendars();
  console.log(`対象カレンダー数: ${calendars.length}`);

  // 2. 差分期間のイベントのみ取得（全カレンダー）
  const allEvents = [];
  for (const cal of calendars) {
    console.log(`処理中: ${cal.name} (${cal.id})`);
    const events = fetchEventsInRange(cal.id, incrementalStart, boundary);
    console.log(`  → ${events.length} 件のイベントを取得`);
    allEvents.push(...events);
  }

  console.log(`差分イベント合計: ${allEvents.length}`);

  if (allEvents.length === 0) {
    console.log('差分アーカイブ対象のイベントがありませんでした。');
    return;
  }

  // 3. 年ごとにグループ化
  const eventsByYear = groupEventsByYear(allEvents);

  // 4. 既存JSONとマージして保存
  const folder = getOrCreateArchiveFolder();
  for (const [year, newEvents] of Object.entries(eventsByYear)) {
    mergeAndSaveYear(folder, parseInt(year), newEvents, calendars);
  }

  console.log('=== 差分アーカイブ処理が完了しました ===');
}

// ============================================================
// トリガーの自動セットアップ
// ============================================================

/**
 * monthlyIncrementalExport を毎月1日に自動実行するトリガーを設定する。
 * この関数を1回手動実行するだけでOK。
 * 既に同名トリガーがあれば重複作成しない。
 */
function setupMonthlyTrigger() {
  // 既存トリガーをチェック（重複防止）
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === 'monthlyIncrementalExport') {
      console.log('トリガーは既に設定されています。');
      console.log(`  次回実行予定: トリガーID ${trigger.getUniqueId()}`);
      return;
    }
  }

  // 毎月1日の午前2時に実行するトリガーを作成
  ScriptApp.newTrigger('monthlyIncrementalExport')
    .timeBased()
    .onMonthDay(1)
    .atHour(2)
    .create();

  console.log('✅ 月次トリガーを作成しました。');
  console.log('   実行関数: monthlyIncrementalExport');
  console.log('   スケジュール: 毎月1日 午前2:00〜3:00');
}

/**
 * 設定済みのトリガーを全て削除する（トリガーのリセット用）。
 */
function removeAllTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    ScriptApp.deleteTrigger(trigger);
    console.log(`トリガーを削除: ${trigger.getHandlerFunction()} (${trigger.getUniqueId()})`);
  }
  console.log(`合計 ${triggers.length} 件のトリガーを削除しました。`);
}

// ============================================================
// カレンダー一覧の取得
// ============================================================

/**
 * ユーザーがアクセス可能な全カレンダーを取得する。
 * @returns {Array<{id: string, name: string, color: string}>}
 */
function fetchAllCalendars() {
  const calendars = [];
  let pageToken = null;

  do {
    const params = {
      minAccessRole: 'reader',
      showHidden: false,
    };
    if (pageToken) {
      params.pageToken = pageToken;
    }

    const response = Calendar.CalendarList.list(params);
    const items = response.items || [];

    for (const item of items) {
      calendars.push({
        id: item.id,
        name: item.summary || '(無題)',
        color: item.backgroundColor || '#4285f4',
      });
    }

    pageToken = response.nextPageToken;
  } while (pageToken);

  return calendars;
}

// ============================================================
// イベントの取得
// ============================================================

/**
 * 指定カレンダーから、境界日より前の全イベントを取得する。
 * Calendar APIのページネーションを完全にハンドリングする。
 * 
 * @param {string} calendarId - カレンダーID
 * @param {Date} boundary - この日時より前のイベントを取得
 * @returns {Array<Object>} AppEvent互換のイベント配列
 */
function fetchEventsBeforeBoundary(calendarId, boundary) {
  return fetchEventsInRange(calendarId, new Date(OLDEST_YEAR, 0, 1), boundary);
}

/**
 * 指定カレンダーから、指定期間のイベントを取得する。
 * ページネーション完全対応。差分取得にも全取得にも使える汎用関数。
 * 
 * @param {string} calendarId - カレンダーID
 * @param {Date} timeMin - 取得開始日時（この日以降）
 * @param {Date} timeMax - 取得終了日時（この日より前）
 * @returns {Array<Object>} AppEvent互換のイベント配列
 */
function fetchEventsInRange(calendarId, timeMin, timeMax) {
  const events = [];
  let pageToken = null;

  do {
    try {
      const params = {
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        maxResults: 2500,
        singleEvents: true,       // 繰り返し予定を個別イベントに展開
        orderBy: 'startTime',
        showDeleted: false,
      };
      if (pageToken) {
        params.pageToken = pageToken;
      }

      const response = Calendar.Events.list(calendarId, params);
      const items = response.items || [];

      for (const item of items) {
        const event = convertToAppEvent(item, calendarId);
        if (event) {
          events.push(event);
        }
      }

      pageToken = response.nextPageToken;
    } catch (e) {
      console.warn(`カレンダー ${calendarId} の取得中にエラー: ${e.message}`);
      break;
    }
  } while (pageToken);

  return events;
}

// ============================================================
// データ変換
// ============================================================

/**
 * Calendar APIのイベントオブジェクトをAppEvent形式に変換する。
 * 
 * @param {Object} apiEvent - Calendar APIのイベントオブジェクト
 * @param {string} calendarId - カレンダーID
 * @returns {Object|null} AppEvent形式のオブジェクト、または変換不可の場合null
 */
function convertToAppEvent(apiEvent, calendarId) {
  // キャンセル済みイベントはスキップ
  if (apiEvent.status === 'cancelled') {
    return null;
  }

  const isAllDay = !!(apiEvent.start && apiEvent.start.date);

  let start, end;
  if (isAllDay) {
    // 終日予定: date フィールド (YYYY-MM-DD)
    start = apiEvent.start.date;
    end = apiEvent.end.date;
  } else {
    // 時刻指定予定: dateTime フィールド (ISO 8601)
    start = apiEvent.start.dateTime || apiEvent.start.date;
    end = apiEvent.end.dateTime || apiEvent.end.date;
  }

  if (!start) {
    return null;
  }

  // イベント個別の色を解決（colorIdがあればhexに変換）
  let eventColor = null;
  if (apiEvent.colorId && EVENT_COLORS_MAP[apiEvent.colorId]) {
    eventColor = EVENT_COLORS_MAP[apiEvent.colorId];
  }

  return {
    id: apiEvent.id,
    calendarId: calendarId,
    title: apiEvent.summary || '(無題)',
    description: apiEvent.description || '',
    location: apiEvent.location || '',
    start: start,
    end: end || start,
    isAllDay: isAllDay,
    eventColor: eventColor,
  };
}

/**
 * Google Calendar APIのイベントcolorId → hex色マッピング。
 * フロントエンドのcalendarClient.tsと同じ値を使用。
 */
const EVENT_COLORS_MAP = {
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

// ============================================================
// グループ化
// ============================================================

/**
 * イベントを開始日の年でグループ化する。
 * 
 * @param {Array<Object>} events - AppEvent形式のイベント配列
 * @returns {Object<string, Array<Object>>} 年 → イベント配列のマップ
 */
function groupEventsByYear(events) {
  const groups = {};

  for (const event of events) {
    // start は "YYYY-MM-DD" または ISO 8601 文字列
    const year = new Date(event.start).getFullYear();

    if (!groups[year]) {
      groups[year] = [];
    }
    groups[year].push(event);
  }

  return groups;
}

// ============================================================
// JSON構築
// ============================================================

/**
 * アーカイブ用のJSON構造体を構築する。
 * フロントエンドのAppEvent型と互換性のあるスキーマ。
 * 
 * @param {number} year - 対象年
 * @param {Array<Object>} events - その年のイベント配列
 * @param {Array<Object>} allCalendars - 全カレンダー情報
 * @returns {string} JSON文字列
 */
function buildArchiveJson(year, events, allCalendars) {
  // その年のイベントに登場するカレンダーのみフィルタ
  const usedCalendarIds = new Set(events.map(e => e.calendarId));
  const calendarsInYear = allCalendars.filter(c => usedCalendarIds.has(c.id));

  // 開始日時でソート
  events.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

  const archive = {
    exportedAt: new Date().toISOString(),
    year: year,
    calendars: calendarsInYear,
    events: events,
  };

  return JSON.stringify(archive, null, 2);
}

// ============================================================
// マージ・保存ロジック（共通）
// ============================================================

/**
 * 指定年のイベントを既存JSONとマージし、重複排除して保存する。
 * exportAllCalendars / monthlyIncrementalExport / exportSingleCalendar
 * の全てで使われる共通のマージ処理。
 * 
 * マージキー: calendarId + "__" + eventId
 * 同一キーの場合は新しいデータで上書き（APIからの最新情報を優先）。
 * 
 * @param {Folder} folder - 保存先フォルダ
 * @param {number} year - 対象年
 * @param {Array<Object>} newEvents - 新たに取得したイベント配列
 * @param {Array<Object>} calendars - カレンダー情報の配列
 */
function mergeAndSaveYear(folder, year, newEvents, calendars) {
  const fileName = `${year}.json`;

  // 1. 既存JSONの読み込み
  const existingFiles = folder.getFilesByName(fileName);
  let existingEvents = [];
  let existingCalendars = [];

  if (existingFiles.hasNext()) {
    try {
      const existingData = JSON.parse(existingFiles.next().getBlob().getDataAsString());
      existingEvents = existingData.events || [];
      existingCalendars = existingData.calendars || [];
    } catch (e) {
      console.warn(`既存ファイルの読み込みに失敗（新規作成します）: ${fileName}`);
    }
  }

  // 2. イベントのマージ（IDベースで重複排除、新データ優先）
  const mergedEventsMap = new Map();
  for (const e of existingEvents) {
    mergedEventsMap.set(`${e.calendarId}__${e.id}`, e);
  }
  for (const e of newEvents) {
    mergedEventsMap.set(`${e.calendarId}__${e.id}`, e);
  }

  // 3. カレンダー情報のマージ
  const calMap = new Map();
  for (const c of existingCalendars) calMap.set(c.id, c);
  for (const c of calendars) calMap.set(c.id, c);

  const mergedEvents = [...mergedEventsMap.values()];
  const mergedCalendars = [...calMap.values()];

  const added = mergedEvents.length - existingEvents.length;

  // 4. JSON生成・保存
  const jsonData = buildArchiveJson(year, mergedEvents, mergedCalendars);
  saveJsonToFolder(folder, fileName, jsonData);
  console.log(`${fileName}: 合計 ${mergedEvents.length} 件（${added >= 0 ? '+' : ''}${added} 件の差分）`);
}

// ============================================================
// Googleドライブ操作
// ============================================================

/**
 * Googleドライブのマイドライブ直下に calendar_archives フォルダを
 * 取得する。存在しなければ新規作成する。
 * 
 * @returns {Folder} Googleドライブのフォルダオブジェクト
 */
function getOrCreateArchiveFolder() {
  const folders = DriveApp.getRootFolder()
    .getFoldersByName(ARCHIVE_FOLDER_NAME);

  if (folders.hasNext()) {
    const folder = folders.next();
    console.log(`既存のフォルダを使用: ${ARCHIVE_FOLDER_NAME}`);
    return folder;
  }

  console.log(`フォルダを新規作成: ${ARCHIVE_FOLDER_NAME}`);
  return DriveApp.getRootFolder().createFolder(ARCHIVE_FOLDER_NAME);
}

/**
 * 指定フォルダにJSONファイルを保存する。
 * 同名のファイルが既に存在する場合は内容を上書きする（冪等性）。
 * 
 * @param {Folder} folder - 保存先フォルダ
 * @param {string} fileName - ファイル名（例: "2024.json"）
 * @param {string} jsonString - JSON文字列
 */
function saveJsonToFolder(folder, fileName, jsonString) {
  const existingFiles = folder.getFilesByName(fileName);

  if (existingFiles.hasNext()) {
    // 既存ファイルを上書き
    const file = existingFiles.next();
    file.setContent(jsonString);
    console.log(`  上書き: ${fileName}`);
  } else {
    // 新規作成
    folder.createFile(fileName, jsonString, 'application/json');
    console.log(`  新規作成: ${fileName}`);
  }
}

// ============================================================
// 分割実行サポート（大量データ向け）
// ============================================================

/**
 * カレンダーが多数ある場合、1つのカレンダーだけを指定して
 * アーカイブを実行する。GASの実行時間制限対策。
 * 既存JSONとマージするので何度でも安全に実行可能。
 * 
 * @param {string} calendarId - 対象カレンダーID
 */
function exportSingleCalendar(calendarId) {
  console.log(`=== 単一カレンダーアーカイブ: ${calendarId} ===`);

  const boundary = getArchiveBoundaryDate();
  const calendars = fetchAllCalendars();
  const targetCal = calendars.find(c => c.id === calendarId);

  if (!targetCal) {
    console.error(`カレンダーが見つかりません: ${calendarId}`);
    return;
  }

  const events = fetchEventsBeforeBoundary(calendarId, boundary);
  console.log(`${events.length} 件のイベントを取得`);

  if (events.length === 0) {
    console.log('アーカイブ対象のイベントがありません。');
    return;
  }

  const eventsByYear = groupEventsByYear(events);
  const folder = getOrCreateArchiveFolder();

  for (const [year, yearEvents] of Object.entries(eventsByYear)) {
    mergeAndSaveYear(folder, parseInt(year), yearEvents, [targetCal]);
  }

  console.log('=== 単一カレンダーアーカイブ完了 ===');
}

// ============================================================
// ユーティリティ
// ============================================================

/**
 * アーカイブフォルダ内の全JSONファイル一覧を表示する（デバッグ用）。
 */
function listArchiveFiles() {
  const folder = getOrCreateArchiveFolder();
  const files = folder.getFiles();

  console.log(`=== ${ARCHIVE_FOLDER_NAME} フォルダの内容 ===`);
  let count = 0;
  while (files.hasNext()) {
    const file = files.next();
    const sizeKB = (file.getSize() / 1024).toFixed(1);
    console.log(`  ${file.getName()} (${sizeKB} KB, 更新: ${file.getLastUpdated()})`);
    count++;
  }
  console.log(`合計: ${count} ファイル`);
}

/**
 * 特定の年のアーカイブJSONの内容を確認する（デバッグ用）。
 * @param {number} year - 対象年
 */
function inspectArchive(year) {
  const folder = getOrCreateArchiveFolder();
  const files = folder.getFilesByName(`${year}.json`);

  if (!files.hasNext()) {
    console.log(`${year}.json は存在しません。`);
    return;
  }

  const data = JSON.parse(files.next().getBlob().getDataAsString());
  console.log(`=== ${year}.json ===`);
  console.log(`エクスポート日時: ${data.exportedAt}`);
  console.log(`カレンダー数: ${data.calendars.length}`);
  console.log(`イベント数: ${data.events.length}`);
  console.log('カレンダー一覧:');
  for (const cal of data.calendars) {
    console.log(`  - ${cal.name} (${cal.id})`);
  }

  // 最初の5件を表示
  console.log('--- 最初の5件 ---');
  for (const event of data.events.slice(0, 5)) {
    console.log(`  [${event.start}] ${event.title} (${event.calendarId})`);
  }

  // 最後の5件を表示
  if (data.events.length > 5) {
    console.log('--- 最後の5件 ---');
    for (const event of data.events.slice(-5)) {
      console.log(`  [${event.start}] ${event.title} (${event.calendarId})`);
    }
  }
}

/**
 * 現在設定されているトリガーの一覧を表示する（デバッグ用）。
 */
function listTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  console.log(`=== 設定済みトリガー（${triggers.length} 件） ===`);
  for (const trigger of triggers) {
    console.log(`  関数: ${trigger.getHandlerFunction()}`);
    console.log(`  タイプ: ${trigger.getEventType()}`);
    console.log(`  ID: ${trigger.getUniqueId()}`);
    console.log('  ---');
  }
}
