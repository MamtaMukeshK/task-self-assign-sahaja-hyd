// Minimal in-memory stand-ins for the Apps Script services Code.gs uses.
const fs = require('fs'), vm = require('vm'), crypto = require('crypto'), path = require('path');
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONL = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAY = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
function formatDate(d, tz, f) { // tz ignored: harness runs in UTC
  const p2 = n => String(n).padStart(2, '0');
  return f.replace(/yyyy|MMMM|MMM|MM|M|dd|d|HH|mm|EEE/g, t => ({
    yyyy: d.getUTCFullYear(), MMMM: MONL[d.getUTCMonth()], MMM: MON[d.getUTCMonth()], MM: p2(d.getUTCMonth()+1),
    M: d.getUTCMonth()+1, dd: p2(d.getUTCDate()), d: d.getUTCDate(), HH: p2(d.getUTCHours()), mm: p2(d.getUTCMinutes()),
    EEE: DAY[d.getUTCDay()] }[t]));
}
function makeSheet(name, id, grid) {
  const g = grid.map(r => r.slice()); let maxCols = Math.max(1, ...g.map(r => r.length));
  // A real date shows as dd/MM/yyyy (an India-locale sheet); getValues hands back the date itself.
  const raw = (r, c) => (g[r-1] && g[r-1][c-1] != null) ? g[r-1][c-1] : '';
  const cell = (r, c) => { const v = raw(r, c); return v instanceof Date ? formatDate(v, '', 'dd/MM/yyyy') : String(v); };
  const sheet = {
    grid: g, writes: 0,
    getName: () => name, getSheetId: () => id, getMaxColumns: () => maxCols,
    insertColumnsAfter: (after, n) => { maxCols += n; },
    getLastRow: () => { for (let r = g.length; r > 0; r--) if (g[r-1].some(v => v !== '')) return r; return 0; },
    getLastColumn: () => { let m = 0; g.forEach(r => r.forEach((v, i) => { if (v !== '') m = Math.max(m, i+1); })); return m; },
    getRange: (r, c, nr = 1, nc = 1) => {
      if (c + nc - 1 > maxCols) throw new Error('out of range');
      const set = v => { while (g.length < r) g.push([]); g[r-1][c-1] = v; sheet.writes++; };
      const rng = {
        getDisplayValues: () => Array.from({length: nr}, (_, i) => Array.from({length: nc}, (_, j) => cell(r+i, c+j))),
        getValues: () => Array.from({length: nr}, (_, i) => Array.from({length: nc}, (_, j) => raw(r+i, c+j))),
        setNumberFormat: f => { rng.fmt = f; return rng; },
        getFormula: () => { const v = cell(r, c); return v.startsWith('=') ? v : ''; },
        setValues: vals => { vals.forEach((row, i) => row.forEach((v, j) => { while (g.length < r + i) g.push([]); g[r - 1 + i][c - 1 + j] = v; })); sheet.writes++; return rng; },
        setValue: v => { if (rng.fmt !== '@' && /^=/.test(v)) throw new Error('formula written'); set(v); return rng; },
        clearContent: () => { set(''); return rng; }
      };
      return rng;
    }
  };
  return sheet;
}
// A Date whose "new Date()" is the given moment, so tests control "today".
function fakeDate(now) {
  if (!now) return Date;
  return class extends Date { constructor(...a) { if (a.length) super(...a); else super(now.getTime()); } };
}
function load(sheets, now) {
  const store = {};
  const ss = { getSheets: () => sheets, getSheetByName: n => sheets.find(s => s.getName() === n) || null,
    // A new Google tab has 26 columns.
    insertSheet: n => { const s = makeSheet(n, 900 + sheets.length, [Array(26).fill('')]); sheets.push(s); return s; },
    getSpreadsheetTimeZone: () => 'UTC' };
  const ctx = {
    SpreadsheetApp: { openById: id => ({ ...ss, openedById: id }), getActiveSpreadsheet: () => ss, flush: () => {} },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    CacheService: { getScriptCache: () => ({ get: k => store[k] || null, put: (k, v) => { store[k] = v; }, remove: k => { delete store[k]; }, removeAll: ks => ks.forEach(k => { delete store[k]; }) }) },
    Utilities: { formatDate: (d, tz, f) => formatDate(d, tz, f), DigestAlgorithm: { MD5: 'md5' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (a, s) => crypto.createHash('md5').update(s, 'utf8').digest(), base64Encode: b => Buffer.from(b).toString('base64') },
    HtmlService: (() => {
      const out = html => { const o = { getContent: () => html, setTitle: () => o, addMetaTag: () => o }; return o; };
      return { createHtmlOutputFromFile: () => out(fs.readFileSync(path.join(__dirname, '..', 'Index.html'), 'utf8')), createHtmlOutput: out };
    })(), JSON, Date: fakeDate(now), String, Number, Math, Error, _cache: store
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8'), ctx);
  return ctx;
}
// Mirrors the layout of the real 28-Sep tab (people's names/numbers replaced with fakes) (headers contain line breaks like the real sheet).
function screenshotGrid() {
  return [
    ['S No', 'Sahaja Yoga\nSpeaker Name', 'Sahaja Yoga\nSpeaker Mobile', 'School Name', 'Area', 'Branch / addres', 'Principal Name'],
    ['1', 'Asha Rao\n9000000001', '', 'Sri Chaitanya School', 'Ameerpet', 'AMEERPET 2', 'Principal A'],
    ['2', 'Vikram Jain\n9000000002', '', 'Sri Chaitanya School', 'Ameerpet', 'JUBILEE HILLS', 'Principal B'],
    ['6', '', '', 'Sri Chaitanya college', 'Dilsuknagar', 'ADIBATLA', 'Principal C'],
    ['', '', '', '', '', '', ''],
    ['7', '', '', 'Sri Chaitanya college', 'Dilsuknagar', 'CHAITANYAPURI CBSE', 'Principal D'],
  ];
}
module.exports = { load, makeSheet, screenshotGrid };
