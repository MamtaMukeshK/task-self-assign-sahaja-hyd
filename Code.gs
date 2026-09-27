/**
 * Sheet Self-Assign — a Google Apps Script web app.
 *
 * Opens the tab named after today's date (e.g. '28-Sep'), shows every column,
 * and lets anyone with the page link claim an open school (empty speaker name)
 * or release one they claimed. Claims are written into the sheet itself, so the
 * sheet and the page always agree. Must be deployed by someone with EDIT access.
 */

var CONFIG = {
  SHEET_ID: '',                                   // leave empty when installed via the sheet's Extensions → Apps Script
  HEADER_ROW: 1,                                  // row that holds the column names
  // Columns are found by words in their header (case-insensitive), so
  // 'Sahaja Yoga Speaker Name' and 'Sahaja Yoga ( IND) Speaker Name' both work.
  NAME_HEADER_WORDS: ['speaker', 'name'],         // required; a row is open while this cell is empty
  MOBILE_HEADER_WORDS: ['speaker', 'mobile'],     // optional; if absent, the mobile goes under the name
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

    if (action === 'claim') {
      if (row.speaker && !sameName_(row.speakerName, name)) throw new Error('Already taken by ' + row.speakerName + '.');
      if (!row.speaker) {
        if (tab.mobileCol) {
          writeText_(sheet, rowNum, tab.nameCol, name);
          writeText_(sheet, rowNum, tab.mobileCol, mobile);
        } else {
          writeText_(sheet, rowNum, tab.nameCol, name + '\n' + mobile); // same style organisers use
        }
      }
    } else if (row.speaker) {
      if (!sameName_(row.speakerName, name)) throw new Error('Only ' + row.speakerName + ' can release this row.');
      sheet.getRange(rowNum, tab.nameCol).clearContent();
      if (tab.mobileCol) sheet.getRange(rowNum, tab.mobileCol).clearContent();
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
 * covers everything except the speaker name/mobile cells, so a claim is refused
 * if the school details of that row changed or rows were moved.
 */
function readTab_(sheet) {
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < CONFIG.HEADER_ROW || lastCol < 1) throw new Error('Tab "' + sheet.getName() + '" is empty.');
  var values = sheet.getRange(CONFIG.HEADER_ROW, 1, lastRow - CONFIG.HEADER_ROW + 1, lastCol).getDisplayValues();
  var headers = values[0];
  var nIdx = findHeader_(sheet, headers, CONFIG.NAME_HEADER_WORDS);
  var mIdx = findHeader_(sheet, headers, CONFIG.MOBILE_HEADER_WORDS);
  if (nIdx < 0) throw new Error('Tab "' + sheet.getName() + '" has no column in row ' + CONFIG.HEADER_ROW +
    ' whose header contains "' + CONFIG.NAME_HEADER_WORDS.join('" and "') + '".');

  var rows = [];
  values.slice(1).forEach(function (r, i) {
    var details = r.filter(function (_, c) { return c !== nIdx && c !== mIdx; });
    if (details.join('').trim() === '') return; // skip blank rows
    var speaker = r[nIdx].trim();
    rows.push({ row: CONFIG.HEADER_ROW + 1 + i, fp: fingerprint_(details), cells: r, speaker: speaker,
      speakerName: speaker.split('\n')[0].trim() }); // first line = name (mobile may follow on line 2)
  });
  return { headers: headers, nameCol: nIdx + 1, mobileCol: mIdx + 1, rows: rows };
}

function buildState_(sheet) {
  var tab = readTab_(sheet);
  return { tab: sheet.getName(), headers: tab.headers, nameIdx: tab.nameCol - 1, rows: tab.rows };
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
