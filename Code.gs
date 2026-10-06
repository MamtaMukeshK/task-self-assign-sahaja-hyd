/**
 * Sheet Self-Assign — a Google Apps Script web app.
 *
 * Shows a day tab (e.g. '30-Sep'; today's by default, any later day can be
 * picked) with every column, and lets anyone with the page link claim a place
 * on a school that still has free slots, or release their own place. A person
 * can't hold two schools that start at the same time on the same day. Claims are written into the sheet itself, so the
 * sheet and the page always agree. Must be deployed by someone with EDIT access.
 */

// Shown on the page so it's easy to confirm which version is deployed.
var VERSION = '2026-10-06.4';

var CONFIG = {
  // Time zone for "today" and "now" (which day opens, which slots have ended).
  // Fixed to India so it doesn't depend on the sheet's own setting; '' = use the sheet's.
  TIME_ZONE: 'Asia/Kolkata',
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

  CACHE_SECONDS: 30,   // shared read cache; also cleared at once on every claim/release and on edits typed in the sheet
  LOCK_WAIT_MS: 10000, // how long a claim waits for its turn
  MAX_NAME_LENGTH: 60,
  MAX_PEOPLE_PER_CLAIM: 30,
  // Tab holding the list of speakers (name + mobile) offered on the page. Found
  // by name ('Speaker' or 'Speakers'); created if missing. Everyone registered
  // through the page is added to it (or has their mobile filled in).
  SPEAKERS_TAB_NAMES: ['speaker', 'speakers'],
  SPEAKERS_NEW_TAB_NAME: 'Speakers',
  SPEAKERS_MOBILE_HEADER: 'Mobile',
  // Programs that run on several days (no single date) are on a tab named 'Ongoing' (or 'Ongoing Programs').
  // Only there, each program can also take backups, and has start/end dates and days of the week.
  ONGOING_TAB_NAMES: ['ongoing', 'ongoing programs'],
  ONGOING_LABEL: 'Ongoing programs',
  BACKUP_NAME_HEADER_WORDS: ['backup', 'name'],         // 'Backup Yogis Name': the backups, one per line
  BACKUP_SLOTS_HEADER_WORDS: ['backup', 'needed'],      // 'Backup yogis needed' (blank = 1, 0 = no backups)
  BACKUP_REMAINING_HEADER_WORDS: ['backup', 'still'],   // 'Num of backup yogis still needed', kept up to date
  START_DATE_HEADER_WORDS: ['start', 'date'],
  END_DATE_HEADER_WORDS: ['end', 'date'],               // the program can't be joined after this day
  DAYS_HEADER_WORDS: ['days']                           // 'Days of the Week': 'Mon, Thu', 'Mon to Fri'...
};

// The first day's data is put straight into the page, so it shows without a second trip to the server.
// If that fails for any reason, the page asks for it as usual.
function doGet() {
  var html = HtmlService.createHtmlOutputFromFile('Index').getContent();
  var initial = 'null';
  try {
    initial = JSON.stringify(getState('')).replace(/</g, '\\u003c'); // sheet text can't close the <script>
  } catch (e) {}
  return HtmlService.createHtmlOutput(html.replace('/*INITIAL_STATE*/null', function () { return initial; }))
    .setTitle('Hyderabad 2026 - Self Realization Tour: Schedule & Assignments')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Called by the page: the picked day's rows (today's if none) plus who holds each. */
function getState(tabName) {
  var ss = openSpreadsheet_();
  var day = resolveDay_(ss, tabName);
  var state = cachedState_(day.sheet);
  state.days = day.days;
  state.defaultDay = day.defaultDay;
  state.speakers = speakerList_(ss);
  return markPast_(state, day);
}

/** A day's rows, from the shared cache when fresh (a copy, safe to annotate). */
function cachedState_(sheet) {
  var cache = CacheService.getScriptCache();
  var key = cacheKey_(sheet);
  // Inserting or deleting rows/columns doesn't count as an edit, so a size change also means "read again".
  var size = sheet.getLastRow() + 'x' + sheet.getLastColumn();
  var hit = cache.get(key);
  if (hit) {
    var cached = JSON.parse(hit);
    if (cached.size === size) return cached;
  }
  var state = buildState_(sheet);
  state.size = size;
  try {
    cache.put(key, JSON.stringify(state), CONFIG.CACHE_SECONDS);
  } catch (e) {
    // Value over the 100 KB cache limit: just serve uncached.
  }
  return JSON.parse(JSON.stringify(state));
}

/**
 * Adds people to a school. By default that's the person using the page; they
 * can also list others ('Name 98xxxxxxxx' per line), with or without
 * themselves. Others are written as 'Name mobile (via Registrar)'. A school may
 * go over its total (the extra people show in red); a total of 0 means closed.
 */
// role 'backup' (Ongoing tab only) works on the backup column instead; left out = the main (primary) column.
function claimRow(rowNum, fingerprint, name, mobile, tabName, othersText, includeSelf, role) {
  return mutate_({ action: 'claim', rowNum: rowNum, fingerprint: fingerprint, name: name, mobile: mobile,
    tabName: tabName, othersText: othersText, includeSelf: includeSelf !== false, role: role });
}

/** Takes the person using the page off a school. */
function releaseRow(rowNum, fingerprint, name, tabName, role) {
  return mutate_({ action: 'remove', rowNum: rowNum, fingerprint: fingerprint, name: name, target: name, tabName: tabName, role: role });
}

/** Takes someone the person using the page registered (or themselves) off a school. */
function removePerson(rowNum, fingerprint, name, personName, tabName, role) {
  return mutate_({ action: 'remove', rowNum: rowNum, fingerprint: fingerprint, name: name, target: personName, tabName: tabName, role: role });
}

function mutate_(o) {
  var me = cleanName_(o.name);
  var rowNum = Number(o.rowNum);
  if (!(rowNum % 1 === 0 && rowNum > CONFIG.HEADER_ROW)) throw new Error('Invalid row.');
  var adding = o.action === 'claim' ? peopleToAdd_(me, o) : [];

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(CONFIG.LOCK_WAIT_MS)) throw new Error('Lots of people are registering right now. Please try again.');
  var day, ss;
  try {
    ss = openSpreadsheet_();
    day = resolveDay_(ss, o.tabName);
    var sheet = day.sheet;
    var tab = readTab_(sheet);
    var row = tab.rows.filter(function (r) { return r.row === rowNum; })[0];
    if (!row) throw new Error('That row no longer exists. The list has been refreshed.');
    if (row.fp !== o.fingerprint) throw new Error('That row was edited or moved since you loaded it. Please check it and try again.');
    if (day.past) throw new Error(sheet.getName() + ' is over, so it can only be viewed now.');
    if (day.isToday && row.end && day.now >= row.end) {
      throw new Error('This slot has already ended (' + row.timeText + '), so it can only be viewed now.');
    }
    if (day.ongoing && programEnded_(row, day)) throw new Error('This program has ended, so it can only be viewed now.');
    var backup = o.role === 'backup';
    if (backup && !row.backup) throw new Error('This tab has no backup column.');
    var part = backup ? row.backup : row;     // the role being changed: its people and total
    var other = backup ? row : row.backup;    // the other role of an ongoing program, if any
    var onRow = function (n) { return part.assignees.some(function (a) { return sameName_(a.name, n); }); };

    var people = part.assignees.map(function (a) { return a.text; });
    if (o.action === 'claim') {
      if (part.total <= 0) throw new Error(backup ? 'No backups are needed here (its total is 0).' : 'This school is closed (its total is 0).');
      adding = adding.filter(function (p) { return !onRow(p.name); }); // already on it = nothing to do
      adding.forEach(function (p) {
        if (other && other.assignees.some(function (a) { return sameName_(a.name, p.name); })) {
          throw new Error((p.self ? 'You are' : p.name + ' is') + ' already registered here as ' + (backup ? 'primary' : 'backup') +
            '. Nobody was added. Release that first.');
        }
        // On the Ongoing tab, the same start time only clashes on a shared weekday while both programs run.
        var clash = row.start && tab.rows.filter(function (x) {
          return x.row !== rowNum && x.start === row.start && (!day.ongoing || overlaps_(x, row, day.today)) && onAnyRole_(x, p.name);
        })[0];
        if (clash) {
          throw new Error('Time clash: ' + (p.self ? 'you are' : p.name + ' is') + ' already on ' + describe_(tab, clash) +
            ' at ' + clash.timeText + ' on ' + sheet.getName() + '. Nobody was added. Release that first, or pick a different time.');
        }
      });
      adding.forEach(function (p) { people.push(p.name + ' ' + p.mobile + (p.self ? '' : ' (via ' + me + ')')); });
    } else {
      var idx = -1;
      part.assignees.forEach(function (a, i) { if (idx < 0 && sameName_(a.name, o.target)) idx = i; });
      if (idx < 0) throw new Error(sameName_(o.target, me) ? 'Your name is not on this row.' : o.target + ' is not on this row.');
      var p = part.assignees[idx];
      if (!sameName_(p.name, me) && !sameName_(p.by, me)) throw new Error('Only ' + p.name + (p.by ? ' or ' + p.by : '') + ' can remove ' + p.name + '.');
      people.splice(idx, 1);
    }
    var text = joinPeople_(people);
    var nameCol = backup ? tab.backupCol : tab.nameCol, remainingCol = backup ? tab.backupRemainingCol : tab.remainingCol;
    if (text) writeText_(sheet, rowNum, nameCol, text);
    else sheet.getRange(rowNum, nameCol).clearContent();
    if (remainingCol) {
      var cell = sheet.getRange(rowNum, remainingCol);
      if (!cell.getFormula()) cell.setValue(Math.max(0, part.total - people.length));
    }
    if (adding.length) saveSpeakers_(ss, adding);
    SpreadsheetApp.flush();
    CacheService.getScriptCache().removeAll([cacheKey_(sheet), 'speakers']);
  } finally {
    lock.releaseLock();
  }
  var state = buildState_(day.sheet);
  state.days = day.days;
  state.defaultDay = day.defaultDay;
  state.speakers = speakerList_(ss);
  return markPast_(state, day);
}

/** Everyone a claim should add, each checked: [{name, mobile, self}]. */
function peopleToAdd_(me, o) {
  var list = [];
  if (o.includeSelf) list.push({ name: me, mobile: cleanMobile_(o.mobile), self: true });
  String(o.othersText || '').split('\n').forEach(function (line, i) {
    line = line.trim();
    if (!line) return;
    var m = /^(.*?)[\s,:\-]*((?:\+?91|0)?[\d\s\-().]{10,})$/.exec(line);
    if (!m || !m[1].trim()) throw new Error('Line ' + (i + 1) + ' of "Register others" should be a name then a 10-digit mobile, like "Ravi 9123456789".');
    var mobile;
    try { mobile = cleanMobile_(m[2]); } catch (e) { throw new Error('Line ' + (i + 1) + ' of "Register others" (' + line + '): ' + e.message); }
    list.push({ name: cleanName_(m[1]), mobile: mobile, self: false });
  });
  if (!list.length) throw new Error('Nobody to register: tick "Include me" or add people under "Register others".');
  if (list.length > CONFIG.MAX_PEOPLE_PER_CLAIM) throw new Error('Please register at most ' + CONFIG.MAX_PEOPLE_PER_CLAIM + ' people at a time.');
  var seen = {};
  return list.filter(function (p) { var k = norm_(p.name); if (seen[k]) return false; seen[k] = true; return true; });
}

/** The speakers tab ('Speaker' / 'Speakers'), or null. */
function speakersTab_(ss) {
  return ss.getSheets().filter(function (s) { return CONFIG.SPEAKERS_TAB_NAMES.indexOf(norm_(s.getName())) >= 0; })[0] || null;
}

/**
 * Reads the speakers tab: [{row, name, mobile}]. Name comes from the header
 * 'Speaker' (else one containing 'name'), mobile from a header containing
 * 'mobile' or 'phone', or from a number typed next to the name.
 */
function readSpeakers_(sheet) {
  var lastRow = sheet.getLastRow(), lastCol = sheet.getLastColumn();
  if (lastRow < 1 || lastCol < 1) return { headers: [], nameCol: 0, mobileCol: 0, people: [], maxSerial: 0 };
  var values = sheet.getRange(1, 1, lastRow, lastCol).getDisplayValues();
  var headers = values[0].map(norm_);
  var nIdx = headers.indexOf('speaker');
  if (nIdx < 0) headers.forEach(function (h, i) { if (nIdx < 0 && (h.indexOf('speaker') >= 0 || h.indexOf('name') >= 0)) nIdx = i; });
  var mIdx = -1;
  headers.forEach(function (h, i) { if (mIdx < 0 && (h.indexOf('mobile') >= 0 || h.indexOf('phone') >= 0)) mIdx = i; });
  var people = [], maxSerial = 0;
  values.slice(1).forEach(function (r) { var v = Number(r[0]); if (v > maxSerial) maxSerial = v; });
  if (nIdx >= 0) values.slice(1).forEach(function (r, i) {
    var p = parseAssignees_(r[nIdx])[0];
    if (!p) return;
    var digits = String(mIdx >= 0 && r[mIdx] ? r[mIdx] : p.phone).replace(/\D/g, '');
    if (digits.length > 10 && /^(91|0)/.test(digits)) digits = digits.slice(-10);
    people.push({ row: i + 2, name: p.name, mobile: digits.length === 10 ? digits : '' });
  });
  return { headers: headers, nameCol: nIdx + 1, mobileCol: mIdx + 1, people: people, maxSerial: maxSerial };
}

/** For the page: unique speakers sorted by name; mobile is '' when none is saved yet. */
function speakerList_(ss) {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('speakers');
  if (hit) return JSON.parse(hit);
  var sheet = speakersTab_(ss);
  var seen = {}, list = [];
  (sheet ? readSpeakers_(sheet).people : []).forEach(function (p) {
    var k = norm_(p.name) + '|' + p.mobile;
    if (seen[k]) return;
    seen[k] = true;
    list.push({ name: p.name, mobile: p.mobile });
  });
  // A name with a saved mobile makes the same name without one redundant.
  list = list.filter(function (p) { return p.mobile || !list.some(function (q) { return q.mobile && sameName_(q.name, p.name); }); });
  list.sort(function (a, b) { return norm_(a.name) < norm_(b.name) ? -1 : norm_(a.name) > norm_(b.name) ? 1 : 0; });
  try { cache.put('speakers', JSON.stringify(list), CONFIG.CACHE_SECONDS); } catch (e) {}
  return list;
}

/**
 * Records people in the speakers tab: a known name without a mobile gets it
 * filled in; a new name, or a known name with a different mobile, gets a new
 * row. Only the name, mobile and serial-number cells are ever written.
 */
function saveSpeakers_(ss, people) {
  var sheet = speakersTab_(ss);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SPEAKERS_NEW_TAB_NAME);
    sheet.getRange(1, 1, 1, 3).setValues([['Sr. No.', 'Speaker', CONFIG.SPEAKERS_MOBILE_HEADER]]);
  }
  var tab = readSpeakers_(sheet);
  if (!tab.nameCol) return; // no name column: leave the tab alone
  if (!tab.mobileCol) {
    var col = tab.headers.indexOf('') + 1 || sheet.getLastColumn() + 1;
    if (col > sheet.getMaxColumns()) sheet.insertColumnsAfter(sheet.getMaxColumns(), col - sheet.getMaxColumns());
    sheet.getRange(1, col).setValue(CONFIG.SPEAKERS_MOBILE_HEADER);
    tab.mobileCol = col;
  }
  var serialCol = tab.headers[0] && /^(s|sr)\.?\s*no/.test(tab.headers[0]) ? 1 : 0;
  var nextRow = sheet.getLastRow() + 1;
  var serial = tab.maxSerial;
  people.forEach(function (p) {
    var same = tab.people.filter(function (x) { return sameName_(x.name, p.name); });
    if (same.some(function (x) { return x.mobile === p.mobile; })) return;
    var blank = same.filter(function (x) { return !x.mobile; })[0];
    if (blank) {
      writeText_(sheet, blank.row, tab.mobileCol, p.mobile);
      blank.mobile = p.mobile;
      return;
    }
    if (serialCol) sheet.getRange(nextRow, 1).setValue(++serial);
    writeText_(sheet, nextRow, tab.nameCol, p.name);
    writeText_(sheet, nextRow, tab.mobileCol, p.mobile);
    tab.people.push({ row: nextRow, name: p.name, mobile: p.mobile });
    nextRow++;
  });
}

/** Time zone for today/now: CONFIG.TIME_ZONE, else the sheet's own setting. */
function timeZone_(ss) {
  return CONFIG.TIME_ZONE || ss.getSpreadsheetTimeZone();
}

/** The sheet this script is attached to, or SHEET_ID if it runs as a standalone script. */
function openSpreadsheet_() {
  return CONFIG.SHEET_ID ? SpreadsheetApp.openById(CONFIG.SHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
}

/**
 * All day tabs, in date order. A day tab is named like '30-Sep' or '1-Oct'
 * (day, dash, 3-letter month) and is taken to be in the current year. Days
 * before today are marked past: they can be viewed but not changed.
 */
function listDays_(ss) {
  var tz = timeZone_(ss);
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
    days.push({ name: s.getName(), key: key, past: key < today, isToday: key === today, sheet: s,
      label: Utilities.formatDate(date, 'UTC', 'EEE') + ' ' + s.getName() + (key === today ? ' (today)' : key < today ? ' (past)' : '') });
  });
  days.sort(function (x, y) { return x.key < y.key ? -1 : x.key > y.key ? 1 : 0; });
  var ongoing = ss.getSheets().filter(isOngoing_)[0];
  if (ongoing) days.push({ name: ongoing.getName(), key: '', ongoing: true, past: false, isToday: false, sheet: ongoing, label: CONFIG.ONGOING_LABEL });
  return days;
}

function isOngoing_(sheet) { return CONFIG.ONGOING_TAB_NAMES.indexOf(norm_(sheet.getName())) >= 0; }
var MONTHS_ = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * The day tab the person picked, or the default when none was picked: today,
 * unless every timed slot today has already ended, then the next day; with
 * no tab for today, the next day; with only past days, the latest one. Also
 * returns what "now" is, for greying out slots that have ended.
 */
function resolveDay_(ss, tabName) {
  var at = new Date();
  var now = Utilities.formatDate(at, timeZone_(ss), 'HH:mm');
  var clock = Utilities.formatDate(at, timeZone_(ss), 'EEE d MMM HH:mm');
  if (CONFIG.TAB_NAME_OVERRIDE) {
    var forced = ss.getSheetByName(CONFIG.TAB_NAME_OVERRIDE);
    if (!forced) throw new Error('Tab "' + CONFIG.TAB_NAME_OVERRIDE + '" not found.');
    return { sheet: forced, past: false, isToday: false, now: now, clock: clock, defaultDay: forced.getName(), days: [{ name: forced.getName(), label: forced.getName(), past: false }] };
  }
  var days = listDays_(ss);
  if (!days.length) throw new Error('There are no day tabs (named like 30-Sep) yet.');
  var dated = days.filter(function (d) { return !d.ongoing; });
  var upcoming = dated.filter(function (d) { return !d.past; });
  // Today or the next date; once every date is past, the Ongoing tab (else the latest past date).
  var def = upcoming[0] || days.filter(function (d) { return d.ongoing; })[0] || dated[dated.length - 1];
  if (def.isToday && upcoming[1] && dayIsOver_(def.sheet, now)) def = upcoming[1];
  var pick = tabName ? days.filter(function (d) { return d.name === tabName; })[0] : def;
  if (!pick) throw new Error('"' + tabName + '" is not available any more (it may have been renamed). Please pick another date.');
  return { sheet: pick.sheet, past: pick.past, isToday: pick.isToday, ongoing: !!pick.ongoing, now: now, clock: clock,
    today: Utilities.formatDate(at, timeZone_(ss), 'yyyy-MM-dd'), defaultDay: def.name,
    days: days.map(function (d) {
      var out = { name: d.name, label: d.label, past: d.past, today: d.isToday };
      if (d.ongoing) out.ongoing = true;
      return out;
    }) };
}

/** True when today's tab has timed slots and all of them have ended (untimed ones don't count). */
function dayIsOver_(sheet, now) {
  var timed = cachedState_(sheet).rows.filter(function (r) { return r.end; });
  return timed.length > 0 && timed.every(function (r) { return now >= r.end; });
}

/** Marks a past day, and today's slots whose end time has passed, as view-only. */
// Runs by itself whenever someone types in the sheet: forget the cached copy so the page shows it at once.
function onEdit(e) {
  try {
    var keys = ['speakers'];
    if (e && e.range) keys.push(cacheKey_(e.range.getSheet()));
    CacheService.getScriptCache().removeAll(keys);
  } catch (err) {}
}

function markPast_(state, day) {
  state.clock = day.clock;
  state.version = VERSION;
  state.pastDay = !!day.past;
  if (day.ongoing) state.today = day.today; // the page uses it for the same clash rule as the script
  state.rows.forEach(function (r) {
    r.past = state.pastDay || !!(day.isToday && r.end && day.now >= r.end) || !!(day.ongoing && programEnded_(r, day));
  });
  return state;
}

/** An ongoing program is over once its end date has passed (on the end date itself, once its time is over). */
function programEnded_(row, day) {
  return !!row.endDate && (row.endDate < day.today || (row.endDate === day.today && !!row.end && day.now >= row.end));
}

/** Two ongoing programs share a weekday while both still run (no days listed = every day; no dates = always). */
function overlaps_(a, b, today) {
  var sharesDay = !a.days || !b.days || a.days.some(function (d) { return b.days.indexOf(d) >= 0; });
  var from = [a.startDate || '', b.startDate || '', today].sort().pop();
  var ends = [a.endDate, b.endDate].filter(function (e) { return e; }).sort();
  return sharesDay && (!ends.length || from <= ends[0]);
}

/** True when the name is on the row, as primary or as backup. */
function onAnyRole_(row, name) {
  return row.assignees.concat(row.backup ? row.backup.assignees : []).some(function (a) { return sameName_(a.name, name); });
}

/**
 * Weekdays (0 = Sunday) from text like 'Mon, Thu', 'Tue/Fri', 'Mon to Fri' or 'Mon-Fri';
 * null when none are named (blank, 'Daily'...), which counts as every day.
 */
var WEEKDAYS_ = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
function parseDays_(text) {
  var re = /(sun|mon|tue|wed|thu|fri|sat)[a-z]*\.?(?:\s*(?:-|–|to)\s*(sun|mon|tue|wed|thu|fri|sat)[a-z]*)?/g, m, seen = {};
  var s = String(text || '').toLowerCase();
  while ((m = re.exec(s))) {
    var a = WEEKDAYS_.indexOf(m[1]), b = m[2] ? WEEKDAYS_.indexOf(m[2]) : a;
    for (var i = a; ; i = (i + 1) % 7) { seen[i] = true; if (i === b) break; }
  }
  var days = Object.keys(seen).map(Number).sort();
  return days.length ? days : null;
}

/**
 * 'yyyy-MM-dd' from a date cell: a real sheet date (read as a date, so day and month can't be swapped), or text
 * like '15/09/2026' (day first), '15-Sep-2026', '15th Sep 2026', 'Sep 15, 2026' or '2026-09-15'. '' if none.
 */
function dateKey_(v, tz) {
  if (v && typeof v.getTime === 'function') return isNaN(v.getTime()) ? '' : Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  var s = String(v == null ? '' : v).trim().toLowerCase(), x, y, m, d;
  if ((x = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s))) { y = +x[1]; m = +x[2]; d = +x[3]; }
  else if ((x = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4}|\d{2})$/.exec(s))) { d = +x[1]; m = +x[2]; y = +x[3]; }
  else if ((x = /^(\d{1,2})(?:st|nd|rd|th)?[\s\-\/]*([a-z]{3})[a-z]*\.?[\s\-\/,]*(\d{4})$/.exec(s))) { d = +x[1]; m = MONTHS_.indexOf(x[2]) + 1; y = +x[3]; }
  else if ((x = /^([a-z]{3})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/.exec(s))) { m = MONTHS_.indexOf(x[1]) + 1; d = +x[2]; y = +x[3]; }
  else return '';
  if (y < 100) y += 2000;
  var date = new Date(Date.UTC(y, m - 1, d, 12));
  if (m < 1 || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return '';
  return Utilities.formatDate(date, 'UTC', 'yyyy-MM-dd');
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
  // Ongoing tab only: backups (with their own total and "still needed"), start/end dates and weekdays.
  var ongoing = isOngoing_(sheet), bIdx = -1, bsIdx = -1, brIdx = -1, dIdx = -1, starts = [], ends = [];
  if (ongoing) {
    bIdx = findHeader_(sheet, headers, CONFIG.BACKUP_NAME_HEADER_WORDS);
    brIdx = findHeader_(sheet, headers, CONFIG.BACKUP_REMAINING_HEADER_WORDS, [bIdx]);
    bsIdx = findHeader_(sheet, headers, CONFIG.BACKUP_SLOTS_HEADER_WORDS, [bIdx, brIdx]);
    dIdx = findHeader_(sheet, headers, CONFIG.DAYS_HEADER_WORDS);
    var tz = openSpreadsheet_().getSpreadsheetTimeZone();
    var dates = function (words) {
      var c = findHeader_(sheet, headers, words);
      if (c < 0 || values.length < 2) return [];
      return sheet.getRange(CONFIG.HEADER_ROW + 1, c + 1, values.length - 1, 1).getValues().map(function (v) { return dateKey_(v[0], tz); });
    };
    starts = dates(CONFIG.START_DATE_HEADER_WORDS);
    ends = dates(CONFIG.END_DATE_HEADER_WORDS);
  }

  var rows = [];
  values.slice(1).forEach(function (r, i) {
    // The page itself changes the speaker and "still needed" cells, so they are
    // left out of the fingerprint; everything else must be unchanged.
    var details = r.filter(function (_, c) { return c !== nIdx && c !== rIdx && c !== bIdx && c !== brIdx; });
    if (details.join('').trim() === '') return; // skip blank rows
    var speaker = r[nIdx].trim();
    var assignees = parseAssignees_(speaker);
    var total = slotsFrom_(sIdx >= 0 ? r[sIdx] : '');
    var timeText = '';
    tIdxs.forEach(function (c) { if (!timeText && r[c].trim()) timeText = r[c].trim(); });
    var row = { row: CONFIG.HEADER_ROW + 1 + i, fp: fingerprint_(details), cells: r, speaker: speaker,
      assignees: assignees, total: total, remaining: Math.max(0, total - assignees.length),
      over: Math.max(0, assignees.length - total),
      timeText: timeText, start: startTime_(timeText), end: endTime_(timeText) };
    if (ongoing) {
      if (bIdx >= 0) {
        var backups = parseAssignees_(r[bIdx].trim()), bTotal = slotsFrom_(bsIdx >= 0 ? r[bsIdx] : '');
        row.backup = { assignees: backups, total: bTotal, remaining: Math.max(0, bTotal - backups.length),
          over: Math.max(0, backups.length - bTotal) };
      }
      row.startDate = starts[i] || '';
      row.endDate = ends[i] || '';
      row.days = parseDays_(dIdx >= 0 ? r[dIdx] : '');
    }
    rows.push(row);
  });
  return { headers: headers, nameCol: nIdx + 1, remainingCol: rIdx + 1, backupCol: bIdx + 1, backupRemainingCol: brIdx + 1,
    ongoing: ongoing, slotsHeader: sIdx >= 0 ? headers[sIdx] : '', rows: rows };
}

function buildState_(sheet) {
  var tab = readTab_(sheet);
  var state = { tab: sheet.getName(), headers: tab.headers, nameIdx: tab.nameCol - 1, slotsHeader: tab.slotsHeader, rows: tab.rows };
  if (tab.ongoing) { state.ongoing = true; state.backupIdx = tab.backupCol - 1; }
  return state;
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
    var via = /\s*\(via ([^)]+)\)\s*$/i.exec(joined);
    if (via) joined = joined.slice(0, via.index);
    var phone = joined.match(PHONE_);
    var name = joined.replace(PHONE_, '').replace(/[\s,:;\-]+$/, '').replace(/\s+/g, ' ').trim() || lines[0];
    return { name: name, phone: phone ? phone[0].trim() : '', by: via ? via[1].trim() : '', text: lines.join('\n') };
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

/**
 * End time as 'HH:MM' from free text: the time after 'to' or a dash
 * ('2pm to 3pm' -> 15:00, '3:30 to 4:30 pm' -> 16:30). Without an end, or with
 * an end that doesn't make sense (e.g. '3:00 PM - 12 sessions'), the slot is
 * taken to last 1 hour. '' when there's no start time.
 */
function endTime_(text) {
  var start = startTime_(text);
  if (!start) return '';
  var startMin = Number(start.slice(0, 2)) * 60 + Number(start.slice(3));
  var s = String(text).toLowerCase();
  var first = /(\d{1,2})(?:\s*[:.]\s*(\d{2}))?(?::\d{2})?/.exec(s);
  var rest = s.slice(first.index + first[0].length);
  var m = /^\s*(?:[ap]\.?\s?m\.?)?\s*(?:to|till|until|-|–)\s*(\d{1,2})(?:\s*[:.]\s*(\d{2}))?(?::\d{2})?\s*(?:([ap])\.?\s?m)?/.exec(rest);
  var endMin = startMin + 60;
  if (m && Number(m[1]) <= 23 && Number(m[2] || 0) <= 59) {
    var h = Number(m[1]) % 12 + (m[3] === 'p' || (!m[3] && startMin >= 12 * 60 && Number(m[1]) < 12) ? 12 : 0);
    if (!m[3] && Number(m[1]) > 12) h = Number(m[1]);
    var e = h * 60 + Number(m[2] || 0);
    if (e <= startMin) e += 12 * 60;
    if (e > startMin && e - startMin <= 6 * 60) endMin = e;
  }
  if (endMin >= 24 * 60) endMin = 24 * 60 - 1;
  var hh = Math.floor(endMin / 60), mm = endMin % 60;
  return (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm;
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

/**
 * Exactly 10 digits. Spaces, dashes, dots and brackets are ignored, and a
 * leading +91, 91 or 0 is dropped. Returns the plain 10 digits.
 */
function cleanMobile_(raw) {
  var digits = String(raw == null ? '' : raw).replace(/[\s\-().]/g, '');
  if (/^\+?91\d{10}$/.test(digits)) digits = digits.slice(-10);
  else if (/^0\d{10}$/.test(digits)) digits = digits.slice(1);
  if (!/^\d{10}$/.test(digits)) throw new Error('Please enter a 10-digit mobile number.');
  return digits;
}

/** Index of the one header containing all the words, -1 if none; errors if several match. Columns in skip are passed over. */
function findHeader_(sheet, headers, words, skip) {
  var hits = [];
  headers.forEach(function (h, i) {
    var text = norm_(h);
    if ((skip || []).indexOf(i) < 0 && words.every(function (w) { return text.indexOf(w) >= 0; })) hits.push(i);
  });
  if (hits.length > 1) throw new Error('Tab "' + sheet.getName() + '" has several columns whose header contains "' +
    words.join('" and "') + '". Please rename all but one.');
  return hits.length ? hits[0] : -1;
}

function sameName_(a, b) { return norm_(a) === norm_(b); }
function norm_(s) { return String(s).toLowerCase().replace(/\s+/g, ' ').trim(); }
function cacheKey_(sheet) { return 'state:' + sheet.getSheetId(); }
