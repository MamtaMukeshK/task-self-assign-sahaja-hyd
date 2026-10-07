/**
 * Follow-up Program sign-up: the server for the Follow-up workbook (a separate sheet and page link from the tour).
 *
 * Organisers type regular sessions into "Program plan"; generateSlots turns each line into one row per date in
 * "Slots" (weekly trigger + "Program -> Update slots now"). Volunteers book and release single dates on the page;
 * their entries go into the date's Volunteers cell ("Name 9876543210", "(via X)" when registered by someone else).
 * Design: docs/followup/SPEC.md and docs/followup/STAGE1_PLAN.md.
 */

var VERSION = 'followup-2026-10-07.1';

var CONFIG = {
  TIME_ZONE: 'Asia/Kolkata',
  SHEET_ID: '',                // leave empty when installed via the sheet's Extensions -> Apps Script
  PLAN_TAB: 'Program plan',
  SLOTS_TAB: 'Slots',
  REPORT_TAB: 'Update report',
  CACHE_SECONDS: 30,
  LOCK_WAIT_MS: 10000,
  GENERATOR_LOCK_WAIT_MS: 30000,
  MAX_NAME_LENGTH: 60,
  MAX_PEOPLE_PER_REGISTER: 10,
  MAX_ENTRIES_PER_REGISTER: 100, // people x dates
  RELEASE_CLOSES_HOURS: 12,
  OPEN_ENDED_DAYS: 84,         // a line with no Until date keeps 12 weeks of dates ahead
  MAX_DAYS_AHEAD: 366,
  DEFAULT_DAYS: 21,            // getSlots range when the page gives no end date
  WEEKLY_HOUR: 22,             // the weekly update runs on Sunday between 22:00 and 23:00 India time
  SPEAKERS_TAB_NAMES: ['speaker', 'speakers'],
  SPEAKERS_NEW_TAB_NAME: 'Speakers',
  SPEAKERS_MOBILE_HEADER: 'Mobile'
};

var FREQUENCIES = ['Daily', 'Daily, weekdays only (Mon-Fri)', 'Weekly', 'Every 2 weeks', 'Monthly, same weekday',
  'Monthly, same date', 'One-off'];
var DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Column titles the script creates. Columns are found by title (any order, any case), so organisers may move them.
var PLAN_COLS = [
  ['line', 'Line ID', 'Filled in by the script (P1, P2...). Do not change or copy it.'],
  ['day', 'Day', 'Monday...Sunday, or Every day (Daily lines).'],
  ['start', 'Start', 'e.g. 6:30 PM'], ['end', 'End', 'e.g. 7:30 PM (blank = 1 hour)'],
  ['freq', 'Frequency', 'Pick from the list.'],
  ['week', 'Week of month', 'Monthly, same weekday only: 1st, 2nd, 3rd, 4th or last.'],
  ['dom', 'Day of month', 'Monthly, same date only: 1 to 31. Months without that date are skipped.'],
  ['centre', 'Centre', ''], ['address', 'Address', ''], ['map', 'Google map', 'Link to the place on Google Maps.'],
  ['places', 'Places', 'Volunteers needed per date (blank = 1, 0 = closed).'],
  ['from', 'From', 'First date (the date itself for One-off).'],
  ['until', 'Until', 'Last date. Blank = keep 12 weeks of dates ahead.'],
  ['contact', 'Contact', 'Organiser name + phone, shown when release is closed.'], ['notes', 'Notes', '']
];
var SLOT_COLS = [
  ['id', 'Slot ID', 'Filled in by the script. Never change it.'], ['date', 'Date', ''], ['day', 'Day', ''],
  ['start', 'Start', ''], ['end', 'End', ''], ['centre', 'Centre', ''], ['address', 'Address', ''], ['map', 'Map', ''],
  ['contact', 'Contact', 'Organisers may change.'], ['places', 'Places', 'Organisers may change.'],
  ['status', 'Status', 'Open or Cancelled. To drop a date, set Cancelled (do not delete the row).'],
  ['volunteers', 'Volunteers', 'Written by the page. Fix by hand only when needed.'],
  ['remaining', 'Still needed', 'Written by the page.'],
  ['notice', 'Cancellation notice sent', 'Written by the WhatsApp-list tool.'], ['notes', 'Notes', 'Organisers may change.']
];
var COL_ALIASES = { centre: ['center'], map: ['google map'], dom: ['date of month'] };

// ---------------------------------------------------------------- sheet menu, setup, triggers

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Program')
    .addItem('Update slots now', 'menuUpdateSlots')
    .addItem('Set up the sheet (first time)', 'setUpSheet')
    .addToUi();
}

/** Clears the shared read cache when someone types in the sheet. */
function onEdit(e) {
  bumpCache_();
}

/** Creates the missing tabs (existing tabs are never changed), sets India time and turns on the weekly update. */
function setUpSheet() {
  var ss = openSpreadsheet_();
  ss.setSpreadsheetTimeZone(CONFIG.TIME_ZONE);
  var made = [];
  if (makeTab_(ss, CONFIG.PLAN_TAB, PLAN_COLS, {
    start: 'h:mm am/pm', end: 'h:mm am/pm', from: 'd mmm yyyy', until: 'd mmm yyyy', line: '@', centre: '@', address: '@',
    map: '@', contact: '@', notes: '@' }, {
    day: ['Every day'].concat(DAY_NAMES.slice(1), DAY_NAMES.slice(0, 1)), freq: FREQUENCIES,
    week: ['1st', '2nd', '3rd', '4th', 'last'] })) made.push(CONFIG.PLAN_TAB);
  if (makeTab_(ss, CONFIG.SLOTS_TAB, SLOT_COLS, slotFormats_(), { status: ['Open', 'Cancelled'] })) made.push(CONFIG.SLOTS_TAB);
  if (!speakersTab_(ss)) {
    ss.insertSheet(CONFIG.SPEAKERS_NEW_TAB_NAME).getRange(1, 1, 1, 3).setValues([['Sr. No.', 'Speaker', CONFIG.SPEAKERS_MOBILE_HEADER]]);
    made.push(CONFIG.SPEAKERS_NEW_TAB_NAME);
  }
  var hasTrigger = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'generateSlots'; });
  if (!hasTrigger) {
    ScriptApp.newTrigger('generateSlots').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(CONFIG.WEEKLY_HOUR)
      .inTimezone(CONFIG.TIME_ZONE).create();
  }
  var msg = (made.length ? 'Created: ' + made.join(', ') + '.' : 'All tabs were already there (nothing changed).') +
    (hasTrigger ? '' : ' The weekly update (Sunday night) is on.');
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return msg;
}

function slotFormats_() {
  return { id: '@', date: 'ddd d mmm yyyy', day: '@', start: 'h:mm am/pm', end: 'h:mm am/pm', centre: '@', address: '@',
    map: '@', contact: '@', volunteers: '@', notice: '@', notes: '@' };
}

function makeTab_(ss, name, cols, formats, lists) {
  if (ss.getSheetByName(name)) return false;
  var sheet = ss.insertSheet(name);
  var head = sheet.getRange(1, 1, 1, cols.length);
  head.setValues([cols.map(function (c) { return c[1]; })]).setFontWeight('bold');
  head.setNotes([cols.map(function (c) { return c[2]; })]);
  sheet.setFrozenRows(1);
  var rows = sheet.getMaxRows() - 1;
  cols.forEach(function (c, i) {
    var range = sheet.getRange(2, i + 1, rows, 1);
    if (formats[c[0]]) range.setNumberFormat(formats[c[0]]);
    if (lists[c[0]]) range.setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(lists[c[0]], true).setAllowInvalid(false).build());
  });
  return true;
}

/** Menu "Program -> Update slots now". */
function menuUpdateSlots() {
  var r = generateSlots();
  SpreadsheetApp.getUi().alert(r.summary + (r.notes.length ? '\n\nPlease look at the "' + CONFIG.REPORT_TAB + '" tab: ' +
    r.notes.length + ' item(s) need you.' : ''));
}

// ---------------------------------------------------------------- generator

/**
 * Brings "Slots" in line with "Program plan": adds missing dates; for a plan line whose settings changed, updates or
 * removes its future dates that nobody is on. Dates with volunteers and past dates are never changed; anything that
 * needs an organiser's decision is listed in the report. Safe to run any number of times.
 */
function generateSlots() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(CONFIG.GENERATOR_LOCK_WAIT_MS)) throw new Error('Busy with registrations right now. Please try again in a minute.');
  var notes = [], added = 0, updated = 0, removed = 0;
  try {
    var ss = openSpreadsheet_(), props = PropertiesService.getScriptProperties();
    var today = todayKey_();
    var slots = readSlots_(ss);
    var plan = readPlan_(ss, slots, props, notes);
    var sheet = slots.sheet, c = slots.cols;

    // Rows typed straight into Slots get an ID.
    var taken = {};
    slots.rows.forEach(function (r) { if (r.id) taken[r.id] = true; });
    slots.rows.forEach(function (r) {
      if (r.id) return;
      if (!r.date || !r.start) {
        if (r.raw.some(function (v) { return String(v).trim(); })) notes.push('Slots row ' + r.row + ': needs a Date and a Start time before volunteers can see it.');
        return;
      }
      var base = 'X-' + r.date.replace(/-/g, '') + '-' + r.start.replace(':', ''), id = base, n = 2;
      while (taken[id]) id = base + '-' + n++;
      taken[id] = true;
      r.id = id;
      writeText_(sheet, r.row, c.id, id);
    });

    var byLine = {};
    slots.rows.forEach(function (r) { if (r.line) (byLine[r.line] = byLine[r.line] || []).push(r); });
    var updates = [], deletes = [], fresh = [];
    var handle = function (lineId, line, label) {
      var want = {};
      if (line) planDates_(line, today).forEach(function (d) { want[d] = true; });
      var hash = line ? lineHash_(line) : '';
      var changed = !line || props.getProperty('line:' + lineId) !== hash;
      var have = {};
      (byLine[lineId] || []).forEach(function (r) {
        have[r.date] = true;
        if (!changed || r.date < today) return;
        var diff = line && want[r.date] ? differences_(r, line) : [];
        if (r.people.length) {
          if (!want[r.date]) notes.push(label + ', ' + longDate_(r.date) + ': ' + r.people.length + ' volunteer(s) on it, so it was kept. ' +
            'The plan no longer has this date: set Status to Cancelled, or keep it.');
          else if (diff.length) notes.push(label + ', ' + longDate_(r.date) + ': ' + r.people.length + ' volunteer(s) on it, so it was not changed (' +
            diff.join('; ') + '). Change it by hand if they agree.');
        } else if (!want[r.date]) deletes.push(r.row);
        else if (diff.length) updates.push({ row: r, line: line });
      });
      if (line) Object.keys(want).sort().forEach(function (d) { if (!have[d]) fresh.push(newSlot_(line, d)); });
      if (line) props.setProperty('line:' + lineId, hash);
      else props.deleteProperty('line:' + lineId);
    };
    plan.lines.forEach(function (line) { handle(line.id, line, line.id + ' (' + line.label + ')'); });
    Object.keys(byLine).forEach(function (id) {
      if (!plan.ids[id] && !plan.broken[id] && id.charAt(0) === 'P') handle(id, null, id + ' (no longer in the plan)');
    });

    updates.forEach(function (u) {
      var r = u.row.row, l = u.line;
      sheet.getRange(r, c.start).setValue(l.start);
      sheet.getRange(r, c.end).setValue(l.end);
      ['centre', 'address', 'map', 'contact'].forEach(function (k) { if (c[k]) writeText_(sheet, r, c[k], l[k]); });
      sheet.getRange(r, c.places).setValue(l.places);
      setRemaining_(sheet, r, c, l.places);
      updated++;
    });
    deletes.sort(function (a, b) { return b - a; }).forEach(function (r) { sheet.deleteRow(r); removed++; });
    if (fresh.length) {
      var first = sheet.getLastRow() + 1, width = slots.width;
      if (first + fresh.length - 1 > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), first + fresh.length - 1 - sheet.getMaxRows());
      var formats = slotFormats_();
      Object.keys(formats).forEach(function (k) { if (c[k]) sheet.getRange(first, c[k], fresh.length, 1).setNumberFormat(formats[k]); });
      sheet.getRange(first, 1, fresh.length, width).setValues(fresh.map(function (s) {
        var row = [];
        for (var i = 0; i < width; i++) row.push('');
        Object.keys(s).forEach(function (k) { if (c[k]) row[c[k] - 1] = s[k]; });
        return row;
      }));
      added = fresh.length;
    }
    if (added || removed) {
      var last = sheet.getLastRow();
      if (last > 2) sheet.getRange(2, 1, last - 1, slots.width).sort([{ column: c.date, ascending: true }, { column: c.start, ascending: true }]);
    }
    SpreadsheetApp.flush();
    bumpCache_();
  } finally {
    lock.releaseLock();
  }
  var summary = 'Slots updated: ' + added + ' added, ' + updated + ' changed, ' + removed + ' removed.';
  writeReport_(ss, summary, notes);
  return { summary: summary, added: added, updated: updated, removed: removed, notes: notes };
}

function writeReport_(ss, summary, notes) {
  var sheet = ss.getSheetByName(CONFIG.REPORT_TAB) || ss.insertSheet(CONFIG.REPORT_TAB);
  var lines = ['Last update: ' + Utilities.formatDate(new Date(), CONFIG.TIME_ZONE, 'EEE d MMM yyyy HH:mm'), summary]
    .concat(notes.length ? ['Needs you:'].concat(notes) : ['Nothing needs you.']);
  var rows = Math.max(lines.length, sheet.getLastRow());
  var values = [];
  for (var i = 0; i < rows; i++) values.push([lines[i] || '']);
  sheet.getRange(1, 1, rows, 1).setValues(values);
}

/** The plan's valid lines (missing Line IDs filled in); mistakes are added to notes. */
function readPlan_(ss, slots, props, notes) {
  var sheet = ss.getSheetByName(CONFIG.PLAN_TAB);
  if (!sheet) throw new Error('There is no "' + CONFIG.PLAN_TAB + '" tab. Use Program -> Set up the sheet first.');
  var t = readTable_(sheet, PLAN_COLS, ['line', 'day', 'start', 'freq', 'from']);
  var tz = ss.getSpreadsheetTimeZone(), c = t.cols;
  var max = 0, seen = {}, out = { lines: [], ids: {}, broken: {} };
  var idOf = function (row) { return String(row.display[c.line - 1]).trim().toUpperCase(); };
  t.rows.forEach(function (row) { var m = /^P(\d+)$/.exec(idOf(row)); if (m) max = Math.max(max, +m[1]); });
  slots.rows.forEach(function (r) { var m = /^P(\d+)$/.exec(r.line); if (m) max = Math.max(max, +m[1]); });
  t.rows.forEach(function (row) { var id = idOf(row); if (id) seen[id] = (seen[id] || 0) + 1; });
  var stored = props.getProperties();
  t.rows.forEach(function (row) {
    var get = function (k) { return c[k] ? String(row.display[c[k] - 1]).trim() : ''; };
    if (!PLAN_COLS.some(function (col) { return col[0] !== 'line' && get(col[0]); })) return; // empty line
    var line = parsePlanLine_(get, function (k) { return c[k] ? dateKey_(row.values[c[k] - 1], tz) : ''; });
    var id = get('line').toUpperCase();
    if (id && seen[id] > 1) {
      out.broken[id] = true;
      notes.push('Program plan row ' + row.row + ': Line ID ' + id + ' appears ' + seen[id] + ' times. Clear the Line ID of the copied line.');
      return;
    }
    if (line.error) {
      if (id) out.broken[id] = true;
      notes.push('Program plan row ' + row.row + (id ? ' (' + id + ')' : '') + ': ' + line.error + ' This line was skipped.');
      return;
    }
    if (!id) {
      // A line whose ID was cleared by mistake gets its old ID back when its settings are unchanged.
      var hash = lineHash_(line);
      id = Object.keys(stored).filter(function (k) { return k.indexOf('line:') === 0 && stored[k] === hash && !seen[k.slice(5)]; }).map(function (k) { return k.slice(5); })[0] ||
        'P' + (++max);
      seen[id] = 1;
      writeText_(sheet, row.row, c.line, id);
    }
    line.id = id;
    out.ids[id] = true;
    out.lines.push(line);
  });
  return out;
}

/** One plan line, checked: {freq, weekday, week, dom, start, end, from, until, centre, ...} or {error}. */
function parsePlanLine_(get, getDate) {
  var f = norm_(get('freq')), freq;
  if (/one.?off|once/.test(f)) freq = 'once';
  else if (/month/.test(f)) freq = /date/.test(f) ? 'monthDate' : /weekday|week/.test(f) ? 'monthWeekday' : '';
  else if (/daily|every day/.test(f)) freq = /weekday|mon/.test(f) ? 'weekdays' : 'daily';
  else if (/2 weeks|two weeks|fortnight|alternate/.test(f)) freq = 'biweekly';
  else if (/week/.test(f)) freq = 'weekly';
  if (!freq) return { error: 'Frequency "' + get('freq') + '" is not one of: ' + FREQUENCIES.join(' / ') + '.' };
  var d = norm_(get('day')), weekday = -1;
  DAY_NAMES.forEach(function (n, i) { if (d && (d === n.toLowerCase() || d === n.slice(0, 3).toLowerCase())) weekday = i; });
  if (/weekly|biweekly|monthWeekday/.test(freq) && weekday < 0) return { error: 'Day must be a weekday (Monday...Sunday) for ' + get('freq') + '.' };
  var start = clock_(get('start')), end = get('end') ? clock_(get('end')) : start && plusHour_(start);
  if (!start) return { error: 'Start "' + get('start') + '" is not a time like 6:30 PM.' };
  if (!end || end <= start) return { error: 'End "' + get('end') + '" must be a time after the start.' };
  var from = getDate('from'), until = getDate('until');
  if (!from) return { error: 'From must be a date.' };
  if (get('until') && !until) return { error: 'Until must be a date (or blank).' };
  if (until && until < from) return { error: 'Until is before From.' };
  var line = { freq: freq, weekday: weekday, start: start, end: end, from: from, until: until, centre: get('centre'),
    address: get('address'), map: get('map'), contact: get('contact'), places: slotsFrom_(get('places')) };
  if (freq === 'monthWeekday') {
    var w = norm_(get('week')), m = /^(\d)/.exec(w) || [];
    line.week = /last/.test(w) ? 'last' : /first/.test(w) ? 1 : /second/.test(w) ? 2 : /third/.test(w) ? 3 : /fourth/.test(w) ? 4 : +m[1] || 0;
    if (!line.week || line.week > 4) return { error: 'Week of month must be 1st, 2nd, 3rd, 4th or last.' };
  }
  if (freq === 'monthDate') {
    line.dom = parseInt(get('dom'), 10);
    if (!(line.dom >= 1 && line.dom <= 31)) return { error: 'Day of month must be a number from 1 to 31.' };
  }
  line.label = (freq === 'daily' ? 'Every day' : freq === 'weekdays' ? 'Mon-Fri' : freq === 'once' ? 'One-off' : freq === 'monthDate' ? 'Day ' + line.dom :
    DAY_NAMES[weekday]) + ' ' + start + (line.centre ? ', ' + line.centre : '');
  return line;
}

/** Every date ('yyyy-MM-dd') the line asks for, from today (never earlier) to Until (at most a year ahead). */
function planDates_(line, today) {
  var limit = addDays_(today, CONFIG.MAX_DAYS_AHEAD);
  var until = line.until || addDays_(today, CONFIG.OPEN_ENDED_DAYS);
  if (until > limit) until = limit;
  if (line.freq === 'once') return line.from >= today && line.from <= limit ? [line.from] : [];
  var out = [], firstMatch = '';
  for (var d = line.from; d <= until; d = addDays_(d, 1)) {
    var wd = weekday_(d), dom = Number(d.slice(8)), ok;
    if (line.freq === 'daily') ok = true;
    else if (line.freq === 'weekdays') ok = wd >= 1 && wd <= 5;
    else if (line.freq === 'monthDate') ok = dom === line.dom;
    else if (wd !== line.weekday) ok = false;
    else if (line.freq === 'weekly') ok = true;
    else if (line.freq === 'biweekly') { firstMatch = firstMatch || d; ok = daysBetween_(firstMatch, d) % 14 === 0; }
    else ok = line.week === 'last' ? addDays_(d, 7).slice(5, 7) !== d.slice(5, 7) : Math.ceil(dom / 7) === line.week;
    if (ok && d >= today) out.push(d);
  }
  return out;
}

function lineHash_(l) {
  return [l.freq, l.weekday, l.week || '', l.dom || '', l.start, l.end, l.from, l.until, l.centre, l.address, l.map, l.contact, l.places].join('|');
}

function newSlot_(line, date) {
  return { id: line.id + '-' + date.replace(/-/g, ''), date: date, day: DAY_NAMES[weekday_(date)].slice(0, 3), start: line.start,
    end: line.end, centre: line.centre, address: line.address, map: line.map, contact: line.contact, places: line.places,
    status: 'Open', remaining: line.places };
}

/** What differs between a Slots row and its plan line, in words. */
function differences_(r, l) {
  var out = [];
  ['start', 'end', 'centre', 'address', 'map', 'contact', 'places'].forEach(function (k) {
    if (String(r[k]) !== String(l[k])) out.push(k + ' is "' + r[k] + '", plan says "' + l[k] + '"');
  });
  return out;
}

// ---------------------------------------------------------------- reading Slots

/** Finds columns by title; missing required ones are a clear error. */
function readTable_(sheet, cols, required) {
  var lastRow = sheet.getLastRow(), lastCol = Math.max(1, sheet.getLastColumn());
  var display = lastRow ? sheet.getRange(1, 1, lastRow, lastCol).getDisplayValues() : [[]];
  var values = lastRow ? sheet.getRange(1, 1, lastRow, lastCol).getValues() : [[]];
  var heads = display[0].map(norm_), map = {};
  cols.forEach(function (col) {
    var names = [norm_(col[1])].concat(COL_ALIASES[col[0]] || []);
    var i = -1;
    heads.forEach(function (h, j) { if (i < 0 && names.indexOf(h) >= 0) i = j; });
    if (i >= 0) map[col[0]] = i + 1;
    else if (required.indexOf(col[0]) >= 0) throw new Error('Tab "' + sheet.getName() + '" needs a column titled "' + col[1] + '".');
  });
  var rows = [];
  for (var r = 1; r < display.length; r++) rows.push({ row: r + 1, display: display[r], values: values[r] });
  return { cols: map, rows: rows, width: lastCol };
}

function readSlots_(ss) {
  var sheet = ss.getSheetByName(CONFIG.SLOTS_TAB);
  if (!sheet) throw new Error('There is no "' + CONFIG.SLOTS_TAB + '" tab. Use Program -> Set up the sheet first.');
  var t = readTable_(sheet, SLOT_COLS, ['id', 'date', 'start', 'places', 'status', 'volunteers']);
  var tz = ss.getSpreadsheetTimeZone(), c = t.cols;
  var rows = t.rows.map(function (x) {
    var get = function (k) { return c[k] ? String(x.display[c[k] - 1]).trim() : ''; };
    var id = get('id'), start = clock_(get('start')), end = clock_(get('end'));
    return { row: x.row, raw: x.display, id: id, line: (/^(P\d+)-/i.exec(id) || [])[1] || '',
      date: dateKey_(x.values[c.date - 1], tz), start: start, end: end || (start && plusHour_(start)),
      centre: get('centre'), address: get('address'), map: get('map'), contact: get('contact'), places: slotsFrom_(get('places')),
      cancelled: /cancel/i.test(get('status')), people: parseAssignees_(get('volunteers')), notice: get('notice'), notes: get('notes') };
  });
  return { sheet: sheet, cols: c, rows: rows, width: t.width };
}

/** What the page gets for one date (no row numbers, phones only as typed). */
function pageSlot_(r, now) {
  var start = minutes_(r.date, r.start), end = minutes_(r.date, r.end);
  return { id: r.id, line: r.line, date: r.date, day: weekday_(r.date), start: r.start, end: r.end, centre: r.centre,
    address: r.address, map: r.map, contact: r.contact, places: r.places, cancelled: r.cancelled, notes: r.notes,
    people: r.people.map(function (p) { return { name: p.name, phone: p.phone, by: p.by }; }),
    remaining: Math.max(0, r.places - r.people.length), over: Math.max(0, r.people.length - r.places),
    started: now >= start, ended: now >= end, releaseClosed: start - now < CONFIG.RELEASE_CLOSES_HOURS * 60 };
}

// ---------------------------------------------------------------- page functions

/**
 * Dates from `from` to `to` ('yyyy-MM-dd'; never before today), Open and Cancelled. With a name, also `mine`: every
 * future date where that name is on the list or registered someone.
 */
function getSlots(from, to, name) {
  var ss = openSpreadsheet_(), today = todayKey_();
  from = dateKey_(from, 'UTC') || today;
  if (from < today) from = today;
  to = dateKey_(to, 'UTC') || addDays_(from, CONFIG.DEFAULT_DAYS - 1);
  if (to > addDays_(from, CONFIG.MAX_DAYS_AHEAD)) to = addDays_(from, CONFIG.MAX_DAYS_AHEAD);
  var me = name ? norm_(name) : '';
  var cache = CacheService.getScriptCache(), sheet = ss.getSheetByName(CONFIG.SLOTS_TAB);
  var base = 'slots:' + (cache.get('slots-gen') || '0') + ':' + (sheet ? sheet.getLastRow() + 'x' + sheet.getLastColumn() : '') + ':' + today + ':';
  var rangeKey = base + from + ':' + to, mineKey = base + 'mine:' + me;
  var list = JSON.parse(cache.get(rangeKey) || 'null'), mine = me ? JSON.parse(cache.get(mineKey) || 'null') : [];
  if (!list || !mine) {
    var rows = readSlots_(ss).rows.filter(function (r) { return r.id && r.date >= today && r.start; });
    rows.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.start < b.start ? -1 : a.start > b.start ? 1 : 0; });
    list = rows.filter(function (r) { return r.date >= from && r.date <= to; });
    mine = me ? rows.filter(function (r) { return r.people.some(function (p) { return norm_(p.name) === me || norm_(p.by) === me; }); }) : [];
    try { cache.put(rangeKey, JSON.stringify(list), CONFIG.CACHE_SECONDS); if (me) cache.put(mineKey, JSON.stringify(mine), CONFIG.CACHE_SECONDS); } catch (e) {}
  }
  var now = nowMinutes_();
  var show = function (r) { return pageSlot_(r, now); };
  return { from: from, to: to, today: today, now: Utilities.formatDate(new Date(), CONFIG.TIME_ZONE, 'yyyy-MM-dd HH:mm'),
    slots: list.map(show), mine: mine.map(show), speakers: speakerList_(ss), version: VERSION };
}

/**
 * Books the person using the page (and/or the people in othersText, 'Name 98xxxxxxxx' per line) on the chosen dates,
 * each repeated over `repeat` dates of the same plan line counting the chosen one (1, 4, 8, 7, 14 or 'all').
 * Returns one result per date and person: booked / over (booked beyond the places) / already / skipped (+ reason).
 * previewOnly = the same answer without writing anything, for the confirmation screen.
 */
function registerSlots(slotIds, repeat, name, mobile, othersText, includeSelf, previewOnly) {
  var me = cleanName_(name);
  var people = peopleToAdd_(me, { mobile: mobile, othersText: othersText, includeSelf: includeSelf !== false });
  var ids = [].concat(slotIds || []).map(String);
  if (!ids.length) throw new Error('Please pick at least one date.');
  var count = repeat === 'all' ? Infinity : Number(repeat || 1);
  if (!(count === Infinity || (count >= 1 && count % 1 === 0))) throw new Error('Unknown repeat choice.');

  var lock = LockService.getScriptLock();
  if (!previewOnly && !lock.tryLock(CONFIG.LOCK_WAIT_MS)) throw new Error('Lots of people are registering right now. Please try again.');
  try {
    var ss = openSpreadsheet_(), slots = readSlots_(ss), today = todayKey_(), now = nowMinutes_();
    var live = slots.rows.filter(function (r) { return r.id && r.date >= today && r.start; });
    var targets = [], seen = {}, missing = [];
    ids.forEach(function (id) {
      var pick = live.filter(function (r) { return r.id === id; })[0];
      if (!pick) { missing.push(id); return; }
      var run = pick.line && count > 1 ? live.filter(function (r) { return r.line === pick.line && r.date >= pick.date; }) : [pick];
      run.sort(function (a, b) { return a.date < b.date ? -1 : 1; }).slice(0, count).forEach(function (r) {
        if (!seen[r.id]) { seen[r.id] = true; targets.push(r); }
      });
    });
    if (missing.length && !targets.length) throw new Error('Those dates are no longer in the list. Please refresh the page.');
    if (targets.length * people.length > CONFIG.MAX_ENTRIES_PER_REGISTER) {
      throw new Error('That is ' + targets.length * people.length + ' bookings (' + people.length + ' people x ' + targets.length +
        ' dates). The most at one time is ' + CONFIG.MAX_ENTRIES_PER_REGISTER + '. Please choose fewer dates or people.');
    }
    targets.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.start < b.start ? -1 : 1; });
    var on = function (r, n) { return r.people.some(function (p) { return sameName_(p.name, n); }); };
    var results = [], changed = [], booked = {};
    targets.forEach(function (r) {
      var res = { id: r.id, date: r.date, start: r.start, end: r.end, centre: r.centre, people: [] };
      var shut = r.cancelled ? 'cancelled' : now >= minutes_(r.date, r.start) ? 'started' : r.places <= 0 ? 'closed' :
        r.people.length >= r.places ? 'full' : '';
      var before = r.people.length;
      people.forEach(function (p) {
        var out = { name: p.name, self: p.self };
        if (on(r, p.name)) out.status = 'already';
        else if (shut) { out.status = 'skipped'; out.reason = shut; }
        else {
          var clash = slots.rows.filter(function (x) {
            return x !== r && x.date === r.date && !x.cancelled && x.start < r.end && r.start < x.end && on(x, p.name);
          })[0];
          if (clash) { out.status = 'skipped'; out.reason = 'clash'; out.clash = { id: clash.id, start: clash.start, end: clash.end, centre: clash.centre }; }
          else {
            r.people.push({ name: p.name, phone: p.mobile, by: p.self ? '' : me, text: p.name + ' ' + p.mobile + (p.self ? '' : ' (via ' + me + ')') });
            out.status = r.people.length > r.places ? 'over' : 'booked';
            booked[norm_(p.name)] = p;
          }
        }
        res.people.push(out);
      });
      if (r.people.length > before) changed.push(r);
      results.push(res);
    });
    if (!previewOnly && changed.length) {
      changed.forEach(function (r) { writePeople_(slots, r); });
      saveSpeakers_(ss, Object.keys(booked).map(function (k) { return booked[k]; }));
      SpreadsheetApp.flush();
      bumpCache_();
    }
  } finally {
    if (!previewOnly) lock.releaseLock();
  }
  var tally = { booked: 0, over: 0, already: 0, skipped: 0 };
  results.forEach(function (d) { d.people.forEach(function (p) { tally[p.status]++; }); });
  return { preview: !!previewOnly, results: results, missing: missing, tally: tally,
    slots: changed.map(function (r) { return pageSlot_(r, now); }) };
}

/** Takes one person (the caller by default, or someone they registered) off one date. */
function releaseSlot(slotId, name, personName) {
  var me = cleanName_(name), target = personName ? cleanName_(personName) : me;
  return release_(slotId, me, function (p) { return sameName_(p.name, target); }, false,
    sameName_(target, me) ? 'Your name is not on this date.' : target + ' is not on this date.');
}

/** "Release all N for this date": everyone the caller registered on that date, and the caller. */
function releaseGroup(slotId, name) {
  var me = cleanName_(name);
  return release_(slotId, me, function (p) { return sameName_(p.name, me) || sameName_(p.by, me); }, true, 'You have nobody to release on this date.');
}

function release_(slotId, me, pick, all, notFound) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(CONFIG.LOCK_WAIT_MS)) throw new Error('Lots of people are registering right now. Please try again.');
  try {
    var ss = openSpreadsheet_(), slots = readSlots_(ss), now = nowMinutes_();
    var r = slots.rows.filter(function (x) { return x.id && x.id === String(slotId); })[0];
    if (!r || !r.start) throw new Error('That date is no longer in the list. Please refresh the page.');
    var picked = r.people.filter(pick);
    if (!picked.length) throw new Error(notFound);
    var allowed = picked.filter(function (p) { return sameName_(p.name, me) || sameName_(p.by, me); });
    if (!allowed.length) throw new Error('Only ' + picked[0].name + (picked[0].by ? ' or ' + picked[0].by : '') + ' can remove ' + picked[0].name + '.');
    if (pageSlot_(r, now).releaseClosed) {
      throw new Error('Release is closed: there are under ' + CONFIG.RELEASE_CLOSES_HOURS + ' hours to go. Please call the organiser' +
        (r.contact ? ' (' + r.contact + ')' : '') + '.');
    }
    var drop = all ? allowed : allowed.slice(0, 1); // one person: the first entry the caller may remove
    r.people = r.people.filter(function (p) { return drop.indexOf(p) < 0; });
    writePeople_(slots, r);
    SpreadsheetApp.flush();
    bumpCache_();
  } finally {
    lock.releaseLock();
  }
  return { removed: drop.map(function (p) { return p.name; }), slot: pageSlot_(r, now) };
}

/** Writes a date's Volunteers cell and keeps "Still needed" up to date (left alone if it holds a formula). */
function writePeople_(slots, r) {
  var text = joinPeople_(r.people.map(function (p) { return p.text; }));
  if (text) writeText_(slots.sheet, r.row, slots.cols.volunteers, text);
  else slots.sheet.getRange(r.row, slots.cols.volunteers).clearContent();
  setRemaining_(slots.sheet, r.row, slots.cols, r.places - r.people.length);
}

function setRemaining_(sheet, row, c, n) {
  if (!c.remaining) return;
  var cell = sheet.getRange(row, c.remaining);
  if (!cell.getFormula()) cell.setValue(Math.max(0, n));
}

// ---------------------------------------------------------------- cancellations (organiser side; menu screen in stage 3)

/** Every person on a future Cancelled date whose notice is not sent yet, each with a ready-written WhatsApp link. */
function cancellationList_() {
  var ss = openSpreadsheet_(), today = todayKey_();
  return readSlots_(ss).rows.filter(function (r) { return r.id && r.cancelled && !r.notice && r.date >= today && r.people.length; })
    .map(function (r) {
      return { id: r.id, date: r.date, start: r.start, centre: r.centre, people: r.people.map(function (p) {
        var digits = String(p.phone).replace(/\D/g, '').slice(-10);
        var text = 'Namaste ' + p.name + '. The Follow-up Program session on ' + longDate_(r.date) + ' at ' + twelveHour_(r.start) +
          (r.centre ? ', ' + r.centre : '') + ' is cancelled. Please don\'t go. Your other dates are unchanged.' + (r.contact ? ' - ' + r.contact : '');
        return { name: p.name, phone: digits, by: p.by, link: digits.length === 10 ? 'https://wa.me/91' + digits + '?text=' + encodeURIComponent(text) : '' };
      }) };
    });
}

/** Records that the WhatsApp notices for these dates were sent. */
function markNoticeSent_(slotIds) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(CONFIG.LOCK_WAIT_MS)) throw new Error('Busy right now. Please try again.');
  try {
    var slots = readSlots_(openSpreadsheet_());
    if (!slots.cols.notice) throw new Error('Slots has no "Cancellation notice sent" column.');
    var stamp = 'Sent ' + Utilities.formatDate(new Date(), CONFIG.TIME_ZONE, 'd MMM HH:mm');
    slots.rows.forEach(function (r) { if (r.id && [].concat(slotIds).indexOf(r.id) >= 0) writeText_(slots.sheet, r.row, slots.cols.notice, stamp); });
    bumpCache_();
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------- dates and times (India has no daylight saving)

function todayKey_() { return Utilities.formatDate(new Date(), CONFIG.TIME_ZONE, 'yyyy-MM-dd'); }
function nowMinutes_() {
  var s = Utilities.formatDate(new Date(), CONFIG.TIME_ZONE, 'yyyy-MM-dd HH:mm');
  return minutes_(s.slice(0, 10), s.slice(11));
}
/** Minutes since 1970 of a wall-clock date + 'HH:mm', for comparing moments. */
function minutes_(key, hhmm) {
  return Date.UTC(+key.slice(0, 4), +key.slice(5, 7) - 1, +key.slice(8, 10), +hhmm.slice(0, 2), +hhmm.slice(3, 5)) / 60000;
}
function addDays_(key, n) {
  var d = new Date(Date.UTC(+key.slice(0, 4), +key.slice(5, 7) - 1, +key.slice(8, 10) + n, 12));
  return d.getUTCFullYear() + '-' + pad2_(d.getUTCMonth() + 1) + '-' + pad2_(d.getUTCDate());
}
function weekday_(key) { return new Date(Date.UTC(+key.slice(0, 4), +key.slice(5, 7) - 1, +key.slice(8, 10), 12)).getUTCDay(); }
function daysBetween_(a, b) { return Math.round((minutes_(b, '00:00') - minutes_(a, '00:00')) / 1440); }
function pad2_(n) { return (n < 10 ? '0' : '') + n; }
function plusHour_(hhmm) { var m = Math.min(23 * 60 + 59, +hhmm.slice(0, 2) * 60 + +hhmm.slice(3) + 60); return pad2_(Math.floor(m / 60)) + ':' + pad2_(m % 60); }
function longDate_(key) { var M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return DAY_NAMES[weekday_(key)].slice(0, 3) + ' ' + Number(key.slice(8)) + ' ' + M[+key.slice(5, 7) - 1] + ' ' + key.slice(0, 4); }
function twelveHour_(hhmm) { var h = +hhmm.slice(0, 2); return (h % 12 || 12) + ':' + hhmm.slice(3) + (h < 12 ? ' AM' : ' PM'); }

/** 'HH:mm' from '6:30 PM', '6.30pm', '6 pm', '18:30', '18:30:00'; without AM/PM it is 24-hour time. '' if unreadable. */
function clock_(text) {
  var m = /^(\d{1,2})(?:\s*[:.]\s*(\d{2}))?(?::\d{2})?\s*(?:([ap])\.?\s*m?\.?)?$/.exec(String(text == null ? '' : text).trim().toLowerCase());
  if (!m) return '';
  var h = +m[1], min = +(m[2] || 0);
  if (m[3]) { if (h < 1 || h > 12) return ''; h = h % 12 + (m[3] === 'p' ? 12 : 0); }
  return h > 23 || min > 59 ? '' : pad2_(h) + ':' + pad2_(min);
}

// ---------------------------------------------------------------- shared with the tour page's Code.gs (copied)

function bumpCache_() {
  var cache = CacheService.getScriptCache();
  cache.put('slots-gen', String(new Date().getTime()), 21600);
  cache.remove('speakers');
}

function openSpreadsheet_() {
  return CONFIG.SHEET_ID ? SpreadsheetApp.openById(CONFIG.SHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
}

var MONTHS_ = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
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

/** One person per line; a blank line after a person with no phone keeps the next one separate. */
function joinPeople_(texts) {
  return texts.reduce(function (out, t, i) {
    if (!i) return t;
    return out + (PHONE_.test(texts[i - 1]) ? '\n' : '\n\n') + t;
  }, '');
}

/** Everyone a registration should add, each checked: [{name, mobile, self}]. */
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
  if (!list.length) throw new Error('Nobody to register: tick "Include me too" or add people under "Register others".');
  var seen = {};
  list = list.filter(function (p) { var k = norm_(p.name); if (seen[k]) return false; seen[k] = true; return true; });
  if (list.length > CONFIG.MAX_PEOPLE_PER_REGISTER) throw new Error('Please register at most ' + CONFIG.MAX_PEOPLE_PER_REGISTER + ' people at a time.');
  return list;
}

function speakersTab_(ss) {
  return ss.getSheets().filter(function (s) { return CONFIG.SPEAKERS_TAB_NAMES.indexOf(norm_(s.getName())) >= 0; })[0] || null;
}

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
  list = list.filter(function (p) { return p.mobile || !list.some(function (q) { return q.mobile && sameName_(q.name, p.name); }); });
  list.sort(function (a, b) { return norm_(a.name) < norm_(b.name) ? -1 : norm_(a.name) > norm_(b.name) ? 1 : 0; });
  try { cache.put('speakers', JSON.stringify(list), CONFIG.CACHE_SECONDS); } catch (e) {}
  return list;
}

function saveSpeakers_(ss, people) {
  var sheet = speakersTab_(ss);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SPEAKERS_NEW_TAB_NAME);
    sheet.getRange(1, 1, 1, 3).setValues([['Sr. No.', 'Speaker', CONFIG.SPEAKERS_MOBILE_HEADER]]);
  }
  var tab = readSpeakers_(sheet);
  if (!tab.nameCol) return;
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

/** Writes as plain text so a name is never turned into a formula, number or date. */
function writeText_(sheet, row, col, text) {
  sheet.getRange(row, col).setNumberFormat('@').setValue(text);
}

function slotsFrom_(value) {
  var m = String(value).match(/\d+/);
  return m ? parseInt(m[0], 10) : 1;
}

function cleanName_(raw) {
  var name = String(raw == null ? '' : raw).replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  if (!name) throw new Error('Please enter your name first.');
  if (name.length > CONFIG.MAX_NAME_LENGTH) throw new Error('Name is too long.');
  if (/^[=+\-@]/.test(name)) throw new Error('Name cannot start with = + - or @.');
  return name;
}

function cleanMobile_(raw) {
  var digits = String(raw == null ? '' : raw).replace(/[\s\-().]/g, '');
  if (/^\+?91\d{10}$/.test(digits)) digits = digits.slice(-10);
  else if (/^0\d{10}$/.test(digits)) digits = digits.slice(1);
  if (!/^\d{10}$/.test(digits)) throw new Error('Please enter a 10-digit mobile number.');
  return digits;
}

function sameName_(a, b) { return norm_(a) === norm_(b); }
function norm_(s) { return String(s).toLowerCase().replace(/\s+/g, ' ').trim(); }
