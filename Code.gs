/**
 * Sheet Self-Assign — a Google Apps Script web app.
 *
 * Opens the tab named after today's date (e.g. '28-Sep'), shows every column,
 * and lets anyone with the page link claim a place on a school that still has
 * free slots, or release their own place. Claims are written into the sheet itself, so the
 * sheet and the page always agree. Must be deployed by someone with EDIT access.
 */

var CONFIG = {
  SHEET_ID: '',                                   // leave empty when installed via the sheet's Extensions → Apps Script
  HEADER_ROW: 1,                                  // row that holds the column names
  // The speaker column is found by words in its header (case-insensitive), so
  // 'Sahaja Yoga Speaker Name' and 'Sahaja Yoga ( IND) Speaker Name' both work.
  // This cell lists everyone on the school, one person per line ('Priya 98xxxxxxxx').
  // A phone number on its own line belongs to the name above it, so organiser
  // entries like 'Chandrakant<newline>98xxxxxxxx' count as one person.
  // No other column is ever written.
  NAME_HEADER_WORDS: ['speaker', 'name'],
  // Optional column with how many people a school needs. Blank, missing or
  // non-numeric means 1.
  SLOTS_HEADER_WORDS: ['slot'],
  TAB_NAME_OVERRIDE: '',                          // e.g. '28-Sep' to force a tab while testing

  // Tabs are named like '28-Sep'. Today's date is rendered in these formats
  // (spreadsheet time zone) and compared to tab names exactly, ignoring case.
  TAB_DATE_FORMATS: ['dd-MMM', 'd-MMM'],

  CACHE_SECONDS: 5,    // shared read cache so many viewers don't hammer the sheet
  LOCK_WAIT_MS: 10000, // how long a claim waits for its turn
  MAX_NAME_LENGTH: 60
};

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Pick your school')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Called by the page: today's rows plus who holds each. */
function getState() {
  var ss = openSpreadsheet_();
  var sheet = findTodaySheet_(ss);
  var cache = CacheService.getScriptCache();
  var key = cacheKey_(sheet);
  var hit = cache.get(key);
  if (hit) return JSON.parse(hit);
  var state = buildState_(sheet);
  try {
    cache.put(key, JSON.stringify(state), CONFIG.CACHE_SECONDS);
  } catch (e) {
    // Value over the 100 KB cache limit: just serve uncached.
  }
  return state;
}

function claimRow(rowNum, fingerprint, name, mobile) {
  return mutate_('claim', rowNum, fingerprint, name, mobile);
}

function releaseRow(rowNum, fingerprint, name) {
  return mutate_('release', rowNum, fingerprint, name, '');
}

function mutate_(action, rowNum, fingerprint, rawName, rawMobile) {
  var name = cleanName_(rawName);
  var mobile = action === 'claim' ? cleanMobile_(rawMobile) : '';
  rowNum = Number(rowNum);
  if (!(rowNum % 1 === 0 && rowNum > CONFIG.HEADER_ROW)) throw new Error('Invalid row.');

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(CONFIG.LOCK_WAIT_MS)) throw new Error('Lots of people are claiming right now. Please try again.');
  var sheet;
  try {
    sheet = findTodaySheet_(openSpreadsheet_());
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
    SpreadsheetApp.flush();
    CacheService.getScriptCache().remove(cacheKey_(sheet));
  } finally {
    lock.releaseLock();
  }
  return buildState_(sheet);
}

/** The sheet this script is attached to, or SHEET_ID if it runs as a standalone script. */
function openSpreadsheet_() {
  return CONFIG.SHEET_ID ? SpreadsheetApp.openById(CONFIG.SHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
}

function findTodaySheet_(ss) {
  if (CONFIG.TAB_NAME_OVERRIDE) {
    var forced = ss.getSheetByName(CONFIG.TAB_NAME_OVERRIDE);
    if (!forced) throw new Error('Tab "' + CONFIG.TAB_NAME_OVERRIDE + '" not found.');
    return forced;
  }
  var tz = ss.getSpreadsheetTimeZone();
  var now = new Date();
  var wanted = {};
  CONFIG.TAB_DATE_FORMATS.forEach(function (f) { wanted[norm_(Utilities.formatDate(now, tz, f))] = true; });
  var matches = ss.getSheets().filter(function (s) { return wanted[norm_(s.getName())]; });
  if (matches.length === 1) return matches[0];
  var today = Utilities.formatDate(now, tz, 'EEE d MMM yyyy');
  if (!matches.length) throw new Error('No tab for today (' + today + ') yet.');
  throw new Error('Several tabs look like today (' + today + '): ' +
    matches.map(function (s) { return s.getName(); }).join(', ') +
    '. Ask the sheet owner to narrow TAB_DATE_FORMATS.');
}

/**
 * Reads the whole tab. Every column is returned for display; the fingerprint
 * covers everything except the speaker cell, so a claim is refused
 * if the school details of that row changed or rows were moved.
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

  var rows = [];
  values.slice(1).forEach(function (r, i) {
    var details = r.filter(function (_, c) { return c !== nIdx; });
    if (details.join('').trim() === '') return; // skip blank rows
    var speaker = r[nIdx].trim();
    var assignees = parseAssignees_(speaker);
    var total = slotsFrom_(sIdx >= 0 ? r[sIdx] : '');
    rows.push({ row: CONFIG.HEADER_ROW + 1 + i, fp: fingerprint_(details), cells: r, speaker: speaker,
      assignees: assignees, total: total, remaining: Math.max(0, total - assignees.length) });
  });
  return { headers: headers, nameCol: nIdx + 1, slotsHeader: sIdx >= 0 ? headers[sIdx] : '', rows: rows };
}

function buildState_(sheet) {
  var tab = readTab_(sheet);
  return { tab: sheet.getName(), headers: tab.headers, nameIdx: tab.nameCol - 1, slotsHeader: tab.slotsHeader, rows: tab.rows };
}

/**
 * Splits a speaker cell into people. A person ends at the line holding their
 * phone number, so 'Chandrakant<newline>98xxxxxxxx' and a wrapped
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
