/**
 * Sheet Self-Assign — a Google Apps Script web app.
 *
 * Shows a day tab (e.g. '30-Sep'; today's by default, any later day can be
 * picked) with every column, and lets anyone with the page link claim a place
 * on a school that still has free slots, or release their own place. A person
 * can't hold two schools that start at the same time on the same day. Claims are written into the sheet itself, so the
 * sheet and the page always agree. Must be deployed by someone with EDIT access.
 */

var CONFIG = {
  SHEET_ID: '',                                   // leave empty when installed via the sheet's Extensions → Apps Script
  HEADER_ROW: 1,                                  // row that holds the column names
  // The speaker column is found by words in its header (case-insensitive), so
  // 'Sahaja Yoga Speaker Name' and 'Sahaja Yoga ( IND) Speaker Name' both work.
  // This cell lists everyone on the school, one person per line ('Priya 98xxxxxxxx').
  // A phone number on its own line belongs to the name above it, so organiser
  // entries like 'Ramesh<newline>98xxxxxxxx' count as one person.
  // No other column is ever written.
  NAME_HEADER_WORDS: ['speaker', 'name'],
  // Optional column with how many people a school needs ('Total volunteers
  // needed'). Blank, missing or non-numeric means 1.
  SLOTS_HEADER_WORDS: ['total', 'volunteer'],
  // Optional column the page keeps up to date with how many are still needed
  // ('count of Volunteers still needed'). Left alone if it holds a formula.
  REMAINING_HEADER_WORDS: ['still', 'volunteer'],
  // Optional start-time column(s): any header containing 'time'. The start
  // time is read from free text ('10.30 A.M', '3:30-4:30 PM', '14:00:00').
  TIME_HEADER_WORDS: ['time'],
  TAB_NAME_OVERRIDE: '',                          // e.g. '28-Sep' to force a tab while testing

  CACHE_SECONDS: 5,    // shared read cache so many viewers don't hammer the sheet
  LOCK_WAIT_MS: 10000, // how long a claim waits for its turn
  MAX_NAME_LENGTH: 60
};

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Pick your school')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Called by the page: the picked day's rows (today's if none) plus who holds each. */
function getState(tabName) {
  var day = resolveDay_(openSpreadsheet_(), tabName);
  var cache = CacheService.getScriptCache();
  var key = cacheKey_(day.sheet);
  var hit = cache.get(key);
  var state = hit ? JSON.parse(hit) : buildState_(day.sheet);
  if (!hit) {
    try {
      cache.put(key, JSON.stringify(state), CONFIG.CACHE_SECONDS);
    } catch (e) {
      // Value over the 100 KB cache limit: just serve uncached.
    }
  }
  state.days = day.days;
  return state;
}

function claimRow(rowNum, fingerprint, name, mobile, tabName) {
  return mutate_('claim', rowNum, fingerprint, name, mobile, tabName);
}

function releaseRow(rowNum, fingerprint, name, tabName) {
  return mutate_('release', rowNum, fingerprint, name, '', tabName);
}

function mutate_(action, rowNum, fingerprint, rawName, rawMobile, tabName) {
  var name = cleanName_(rawName);
  var mobile = action === 'claim' ? cleanMobile_(rawMobile) : '';
  rowNum = Number(rowNum);
  if (!(rowNum % 1 === 0 && rowNum > CONFIG.HEADER_ROW)) throw new Error('Invalid row.');

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(CONFIG.LOCK_WAIT_MS)) throw new Error('Lots of people are claiming right now. Please try again.');
  var day;
  try {
    day = resolveDay_(openSpreadsheet_(), tabName);
    var sheet = day.sheet;
    var tab = readTab_(sheet);
    var row = tab.rows.filter(function (r) { return r.row === rowNum; })[0];
    if (!row) throw new Error('That row no longer exists. The list has been refreshed.');
    if (row.fp !== fingerprint) throw new Error('That row was edited or moved since you loaded it. Please check it and try again.');

    var mine = -1;
    row.assignees.forEach(function (a, i) { if (mine < 0 && sameName_(a.name, name)) mine = i; });
    if (action === 'claim') {
      if (mine < 0) { // already on it = nothing to do
        if (row.remaining <= 0) {
          throw new Error(row.assignees.length ? 'No slots left: taken by ' + names_(row.assignees) + '.' : 'This school has no slots.');
        }
        var clash = row.start && tab.rows.filter(function (o) {
          return o.row !== rowNum && o.start === row.start &&
            o.assignees.some(function (a) { return sameName_(a.name, name); });
        })[0];
        if (clash) {
          throw new Error('Time clash: you are already on ' + describe_(tab, clash) + ' at ' + clash.timeText +
            ' on ' + sheet.getName() + '. Release that first, or pick a different time.');
        }
        var texts = row.assignees.map(function (a) { return a.text; }).concat([name + ' ' + mobile]);
        writeText_(sheet, rowNum, tab.nameCol, joinPeople_(texts));
      }
    } else {
      if (mine < 0) throw new Error('Your name is not on this row.');
      var rest = joinPeople_(row.assignees.filter(function (_, i) { return i !== mine; })
        .map(function (a) { return a.text; }));
      if (rest) writeText_(sheet, rowNum, tab.nameCol, rest);
      else sheet.getRange(rowNum, tab.nameCol).clearContent();
    }
    if (tab.remainingCol) {
      var count = row.assignees.length + (action === 'claim' ? (mine < 0 ? 1 : 0) : -1);
      var cell = sheet.getRange(rowNum, tab.remainingCol);
      if (!cell.getFormula()) cell.setValue(Math.max(0, row.total - count));
    }
    SpreadsheetApp.flush();
    CacheService.getScriptCache().remove(cacheKey_(sheet));
  } finally {
    lock.releaseLock();
  }
  var state = buildState_(day.sheet);
  state.days = day.days;
  return state;
}

/** The sheet this script is attached to, or SHEET_ID if it runs as a standalone script. */
function openSpreadsheet_() {
  return CONFIG.SHEET_ID ? SpreadsheetApp.openById(CONFIG.SHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
}

/**
 * Day tabs from today onwards, in date order. A day tab is named like '30-Sep'
 * or '1-Oct' (day, dash, 3-letter month) and is taken to be in the current year.
 */
function listDays_(ss) {
  var tz = ss.getSpreadsheetTimeZone();
  var now = new Date();
  var year = Number(Utilities.formatDate(now, tz, 'yyyy'));
  var today = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
  var days = [];
  ss.getSheets().forEach(function (s) {
    var m = /^(\d{1,2})-([a-z]{3})$/i.exec(s.getName().trim());
    var month = m ? MONTHS_.indexOf(m[2].toLowerCase()) : -1;
    if (month < 0) return;
    var date = new Date(Date.UTC(year, month, Number(m[1]), 12));
    var key = Utilities.formatDate(date, 'UTC', 'yyyy-MM-dd');
    if (key < today) return;
    days.push({ name: s.getName(), key: key, label: Utilities.formatDate(date, 'UTC', 'EEE') + ' ' + s.getName() +
      (key === today ? ' (today)' : ''), sheet: s });
  });
  return days.sort(function (x, y) { return x.key < y.key ? -1 : x.key > y.key ? 1 : 0; });
}
var MONTHS_ = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** The day tab the person picked, or today's (else the next one) when none was picked. */
function resolveDay_(ss, tabName) {
  if (CONFIG.TAB_NAME_OVERRIDE) {
    var forced = ss.getSheetByName(CONFIG.TAB_NAME_OVERRIDE);
    if (!forced) throw new Error('Tab "' + CONFIG.TAB_NAME_OVERRIDE + '" not found.');
    return { sheet: forced, days: [{ name: forced.getName(), key: '', label: forced.getName() }] };
  }
  var days = listDays_(ss);
  if (!days.length) throw new Error('There are no day tabs for today or later yet.');
  var pick = tabName ? days.filter(function (d) { return d.name === tabName; })[0] : days[0];
  if (!pick) throw new Error('"' + tabName + '" is not available any more (it may be in the past or renamed). Please pick another date.');
  return { sheet: pick.sheet, days: days.map(function (d) { return { name: d.name, label: d.label }; }) };
}

/**
 * Reads the whole tab. Every column is returned for display; the fingerprint
 * lets a claim be refused if the school details of that row changed or rows
 * were moved.
 */
function readTab_(sheet) {
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < CONFIG.HEADER_ROW || lastCol < 1) throw new Error('Tab "' + sheet.getName() + '" is empty.');
  var values = sheet.getRange(CONFIG.HEADER_ROW, 1, lastRow - CONFIG.HEADER_ROW + 1, lastCol).getDisplayValues();
  var headers = values[0];
  var nIdx = findHeader_(sheet, headers, CONFIG.NAME_HEADER_WORDS);
  if (nIdx < 0) throw new Error('Tab "' + sheet.getName() + '" has no column in row ' + CONFIG.HEADER_ROW +
    ' whose header contains "' + CONFIG.NAME_HEADER_WORDS.join('" and "') + '".');

  var sIdx = findHeader_(sheet, headers, CONFIG.SLOTS_HEADER_WORDS);
  if (sIdx === nIdx) sIdx = -1;
  var rIdx = findHeader_(sheet, headers, CONFIG.REMAINING_HEADER_WORDS);
  if (rIdx === nIdx || rIdx === sIdx) rIdx = -1;
  // Every time column counts (some tabs have two); the first non-empty one wins.
  var tIdxs = [];
  headers.forEach(function (h, i) {
    var text = norm_(h);
    if (CONFIG.TIME_HEADER_WORDS.every(function (w) { return text.indexOf(w) >= 0; })) tIdxs.push(i);
  });

  var rows = [];
  values.slice(1).forEach(function (r, i) {
    // The page itself changes the speaker and "still needed" cells, so they are
    // left out of the fingerprint; everything else must be unchanged.
    var details = r.filter(function (_, c) { return c !== nIdx && c !== rIdx; });
    if (details.join('').trim() === '') return; // skip blank rows
    var speaker = r[nIdx].trim();
    var assignees = parseAssignees_(speaker);
    var total = slotsFrom_(sIdx >= 0 ? r[sIdx] : '');
    var timeText = '';
    tIdxs.forEach(function (c) { if (!timeText && r[c].trim()) timeText = r[c].trim(); });
    rows.push({ row: CONFIG.HEADER_ROW + 1 + i, fp: fingerprint_(details), cells: r, speaker: speaker,
      assignees: assignees, total: total, remaining: Math.max(0, total - assignees.length),
      timeText: timeText, start: startTime_(timeText) });
  });
  return { headers: headers, nameCol: nIdx + 1, remainingCol: rIdx + 1,
    slotsHeader: sIdx >= 0 ? headers[sIdx] : '', rows: rows };
}

function buildState_(sheet) {
  var tab = readTab_(sheet);
  return { tab: sheet.getName(), headers: tab.headers, nameIdx: tab.nameCol - 1, slotsHeader: tab.slotsHeader, rows: tab.rows };
}

/**
 * Splits a speaker cell into people. A person ends at the line holding their
 * phone number, so 'Ramesh<newline>98xxxxxxxx' and a wrapped
 * 'Vidhya and<newline>team<newline>70xxxxxxxx' are one person each, while
 * 'Priya 98xxxxxxxx<newline>Ravi 91xxxxxxxx' is two. A blank line also ends a
 * person (used after an entry that has no phone number).
 */
var PHONE_ = /\+?\d[\d\s\-]{6,}\d/;

function parseAssignees_(text) {
  var people = [], cur = [];
  String(text || '').split('\n').forEach(function (line) {
    line = line.trim();
    if (line) cur.push(line);
    if (cur.length && (!line || PHONE_.test(line))) { people.push(cur); cur = []; }
  });
  if (cur.length) people.push(cur);
  return people.map(function (lines) {
    var joined = lines.join(' ');
    var phone = joined.match(PHONE_);
    var name = joined.replace(PHONE_, '').replace(/[\s,:;\-]+$/, '').replace(/\s+/g, ' ').trim() || lines[0];
    return { name: name, phone: phone ? phone[0].trim() : '', text: lines.join('\n') };
  });
}

/**
 * Start time as 'HH:MM' (24-hour) from free text, or '' if there's no time.
 * '10.30 A.M' -> 10:30, '3:30-4:30 PM' -> 15:30, '2pmto3pm' -> 14:00,
 * '14:00:00' -> 14:00. Without AM/PM, 1 to 5 o'clock is taken as afternoon.
 */
function startTime_(text) {
  var s = String(text || '').toLowerCase();
  var m = /(\d{1,2})(?:\s*[:.]\s*(\d{2}))?/.exec(s);
  if (!m) return '';
  var h = Number(m[1]), min = Number(m[2] || 0);
  if (h > 23 || min > 59) return '';
  var mark = /\d\s*([ap])\.?\s?m/.exec(s.slice(m.index));
  if (mark && mark[1] === 'p' && h < 12) h += 12;
  else if (mark && mark[1] === 'a' && h === 12) h = 0;
  else if (!mark && h >= 1 && h <= 5) h += 12;
  return (h < 10 ? '0' : '') + h + ':' + (min < 10 ? '0' : '') + min;
}

/** 'S No 5 (Sri Chaitanya School)' for messages. */
function describe_(tab, row) {
  var label = tab.headers[0] ? tab.headers[0].replace(/\s+/g, ' ').trim() + ' ' + row.cells[0] : 'row ' + row.row;
  var school = '';
  tab.headers.forEach(function (h, i) { if (!school && /school|institution/i.test(h) && row.cells[i].trim()) school = row.cells[i].trim(); });
  return school ? label + ' (' + school + ')' : label;
}

/** Number of people a school needs, from its slots cell; blank or non-numeric means 1. */
function slotsFrom_(value) {
  var m = String(value).match(/\d+/);
  return m ? parseInt(m[0], 10) : 1;
}

/** One person per line; a blank line after a person with no phone keeps the next one separate. */
function joinPeople_(texts) {
  return texts.reduce(function (out, t, i) {
    if (!i) return t;
    return out + (PHONE_.test(texts[i - 1]) ? '\n' : '\n\n') + t;
  }, '');
}

function names_(assignees) {
  return assignees.map(function (a) { return a.name; }).join(', ');
}

/** Short hash of a row's contents, so a claim can't land on a row that was edited or moved. */
function fingerprint_(cells) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, cells.join('\u001f'), Utilities.Charset.UTF_8);
  return Utilities.base64Encode(bytes);
}

/** Writes as plain text so a name is never turned into a formula, number or date. */
function writeText_(sheet, row, col, text) {
  sheet.getRange(row, col).setNumberFormat('@').setValue(text);
}

function cleanName_(raw) {
  var name = String(raw == null ? '' : raw).replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  if (!name) throw new Error('Please enter your name first.');
  if (name.length > CONFIG.MAX_NAME_LENGTH) throw new Error('Name is too long.');
  if (/^[=+\-@]/.test(name)) throw new Error('Name cannot start with = + - or @.');
  return name;
}

function cleanMobile_(raw) {
  var mobile = String(raw == null ? '' : raw).replace(/[^\d+ ]/g, '').replace(/\s+/g, ' ').trim();
  var digits = mobile.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 13 || /^\+?$/.test(mobile) || mobile.indexOf('+') > 0) {
    throw new Error('Please enter a valid mobile number (10 digits, optionally with +91).');
  }
  return mobile;
}

/** Index of the one header containing all the words, -1 if none; errors if several match. */
function findHeader_(sheet, headers, words) {
  var hits = [];
  headers.forEach(function (h, i) {
    var text = norm_(h);
    if (words.every(function (w) { return text.indexOf(w) >= 0; })) hits.push(i);
  });
  if (hits.length > 1) throw new Error('Tab "' + sheet.getName() + '" has several columns whose header contains "' +
    words.join('" and "') + '". Please rename all but one.');
  return hits.length ? hits[0] : -1;
}

function sameName_(a, b) { return norm_(a) === norm_(b); }
function norm_(s) { return String(s).toLowerCase().replace(/\s+/g, ' ').trim(); }
function cacheKey_(sheet) { return 'state:' + sheet.getSheetId(); }
