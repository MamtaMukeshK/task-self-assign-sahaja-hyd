const test = require('node:test'), assert = require('node:assert');
const { load, makeSheet, screenshotGrid } = require('./harness');
const NOW = new Date(Date.UTC(2026, 8, 28, 5, 0));
function setup(extraTabs) {
  const sheets = [makeSheet('27-Sep', 1, screenshotGrid()), makeSheet('Dummy-28-Sep', 2, screenshotGrid()),
    makeSheet('28-Sep', 3, screenshotGrid()), makeSheet('Summary', 4, [['x']])].concat(extraTabs || []);
  return { gs: load(sheets, NOW), today: sheets[2], sheets };
}
const openRow = s => s.rows.find(r => !r.speaker);

test('picks exactly today\'s tab, ignoring Dummy-28-Sep', () => {
  const { gs } = setup(); const s = gs.getState();
  assert.equal(s.tab, '28-Sep');
  assert.equal(s.headers.length, 7, 'all columns shown');
  assert.equal(s.rows.length, 4, 'blank row skipped');
  assert.equal(s.rows.filter(r => !r.speaker).length, 2);
});
test('single-digit day tab (e.g. 5-Oct) and 05-Oct both match', () => {
  for (const name of ['5-Oct', '05-Oct']) {
    const gs = load([makeSheet(name, 9, screenshotGrid())], new Date(Date.UTC(2026, 9, 5)));
    assert.equal(gs.getState().tab, name);
  }
});
test('no tab for today gives a clear error', () => {
  const gs = load([makeSheet('27-Sep', 1, screenshotGrid())], NOW);
  assert.throws(() => gs.getState(), /no day tabs for today or later/);
});
test('28-Sep layout: claim writes name + mobile into B only, never the "Speaker Mobile" column', () => {
  const { gs, today, sheets } = setup(); const r = openRow(gs.getState());
  const after = gs.claimRow(r.row, r.fp, '  Priya   Shah ', '+91 98765 43210');
  assert.equal(today.grid[r.row-1][1], 'Priya Shah +91 98765 43210');
  assert.equal(today.grid[r.row-1][2], '', 'column C not written');
  assert.equal(sheets[0].writes + sheets[1].writes, 0, 'other tabs untouched');
  assert.equal(after.rows.find(x => x.row === r.row).assignees[0].name, 'Priya Shah', 'returns fresh state (cache cleared)');
});
test('second person with a stale view loses the race cleanly', () => {
  const { gs, today } = setup(); const view = gs.getState(); const r = openRow(view);
  gs.claimRow(r.row, r.fp, 'Priya', '9876543210');
  assert.throws(() => gs.claimRow(r.row, r.fp, 'Ravi', '9123456789'), /No slots left: taken by Priya/);
  assert.equal(today.grid[r.row-1][1], 'Priya 9876543210');
});
test('same person re-clicking claim is harmless; can claim several rows', () => {
  const { gs } = setup(); const s = gs.getState(); const [a, b] = s.rows.filter(r => !r.speaker);
  gs.claimRow(a.row, a.fp, 'Priya', '9876543210');
  gs.claimRow(a.row, a.fp, 'priya', '9876543210');
  const s2 = gs.claimRow(b.row, b.fp, 'Priya', '9876543210');
  assert.equal(s2.rows.filter(r => r.assignees.some(a => a.name === 'Priya')).length, 2);
});
test('pre-filled rows (from organisers) cannot be claimed', () => {
  const { gs } = setup(); const r = gs.getState().rows[0];
  assert.throws(() => gs.claimRow(r.row, r.fp, 'Priya', '9876543210'), /No slots left: taken by Asha Rao/);
});
test('release: only the claimer, and it clears both cells', () => {
  const { gs, today } = setup(); const r = openRow(gs.getState());
  gs.claimRow(r.row, r.fp, 'Priya', '9876543210');
  assert.throws(() => gs.releaseRow(r.row, r.fp, 'Ravi'), /Your name is not on this row/);
  gs.releaseRow(r.row, r.fp, 'PRIYA');
  assert.deepEqual(today.grid[r.row-1].slice(1, 3), ['', '']);
});
test('row moved/edited since page load is refused (no wrong-row claim)', () => {
  const { gs, today } = setup(); const r = openRow(gs.getState());
  today.grid.splice(1, 0, ['0', '', '', 'New School', 'X', 'Y', 'Z']); // someone inserts a row above
  gs._cache && Object.keys(gs._cache).forEach(k => delete gs._cache[k]);
  assert.throws(() => gs.claimRow(r.row, r.fp, 'Priya', '9876543210'), /edited or moved/);
});
test('input validation: blank name, formula injection, bad mobile, bad row', () => {
  const { gs } = setup(); const r = openRow(gs.getState());
  assert.throws(() => gs.claimRow(r.row, r.fp, '  ', '9876543210'), /enter your name/);
  assert.throws(() => gs.claimRow(r.row, r.fp, '=IMPORTXML("x")', '9876543210'), /cannot start with/);
  assert.throws(() => gs.claimRow(r.row, r.fp, 'Priya', '12345'), /valid mobile/);
  assert.throws(() => gs.claimRow(r.row, r.fp, 'Priya', '98765+43210'), /valid mobile/);
  assert.throws(() => gs.claimRow(1, r.fp, 'Priya', '9876543210'), /Invalid row/);
  assert.throws(() => gs.claimRow(999, r.fp, 'Priya', '9876543210'), /no longer exists/);
});
test('tab missing the speaker column errors loudly instead of guessing', () => {
  const gs = load([makeSheet('28-Sep', 1, [['S No', 'School'], ['1', 'A']])], NOW);
  assert.throws(() => gs.getState(), /no column in row 1 whose header contains "speaker" and "name"/);
});
test('reads are served from the shared cache', () => {
  const { gs } = setup(); gs.getState();
  assert.ok(Object.keys(gs._cache).length === 1);
});
test('uses the attached sheet by default, and SHEET_ID only when set', () => {
  const { gs } = setup();
  assert.equal(gs.openSpreadsheet_().openedById, undefined);
  gs.CONFIG.SHEET_ID = 'abc';
  assert.equal(gs.openSpreadsheet_().openedById, 'abc');
  assert.equal(gs.getState().tab, '28-Sep');
});

// Layout of the real 27-Sep tab: different speaker header, no speaker-mobile column,
// organisers type "name<newline>number" in the speaker cell. (Fake people.)
function sep27Grid() {
  return [
    ['S No', 'Sahaja Yoga ( IND)\nSpeaker Name', 'Local ( HYD)\nSahaja Yogi', 'School Name', 'Branch / addres', 'Phone No', 'RI', 'Phone No', 'Date', 'Time'],
    ['1', 'Asha Rao\n9000000001', 'Local A\n9000000011', 'School X', 'Area 1', '', 'RI A', '9000000021', '27-Sep-26', '3:30'],
    ['2', '', 'Local B\n9000000012', 'School Y', 'Area 2', '', 'RI B', '9000000022', '27-Sep-26', '11:00'],
    ['3', '', 'Local B\n9000000012', 'School Y', 'Area 3', '', 'RI B', '9000000022', '27-Sep-26', '11:00'],
  ];
}
test('27-Sep layout: finds "( IND) Speaker Name" column and writes name + mobile together', () => {
  const sheet = makeSheet('28-Sep', 5, sep27Grid());
  const gs = load([sheet], NOW);
  const s = gs.getState();
  assert.equal(s.headers.length, 10, 'all columns shown');
  assert.equal(s.rows.filter(r => !r.speaker).length, 2);
  const r = s.rows.find(x => !x.speaker);
  const after = gs.claimRow(r.row, r.fp, 'Priya', '9876543210');
  assert.equal(sheet.grid[r.row - 1][1], 'Priya 9876543210', 'name and mobile in one cell');
  assert.equal(sheet.grid[r.row - 1][2], 'Local B\n9000000012', 'Local Sahaja Yogi column untouched');
  const mine = after.rows.find(x => x.row === r.row);
  assert.deepEqual(mine.assignees.map(a => [a.name, a.phone]), [['Priya', '9876543210']]);
  assert.throws(() => gs.claimRow(r.row, r.fp, 'Ravi', '9123456789'), /No slots left: taken by Priya\./);
  assert.throws(() => gs.releaseRow(r.row, r.fp, 'Ravi'), /Your name is not on this row/);
  gs.releaseRow(r.row, r.fp, 'priya');
  assert.equal(sheet.grid[r.row - 1][1], '');
  const first = gs.getState().rows[0];
  assert.throws(() => gs.claimRow(first.row, first.fp, 'Ravi', '9123456789'), /No slots left: taken by Asha Rao\./);
});
test('two columns matching the speaker words is an error, not a guess', () => {
  const g = sep27Grid(); g[0][2] = 'Backup Speaker Name';
  const gs = load([makeSheet('28-Sep', 6, g)], NOW);
  assert.throws(() => gs.getState(), /several columns whose header contains "speaker" and "name"/);
});

test('28-Sep: local contact already in column C of an open row survives claim and release', () => {
  const g = screenshotGrid();
  g[3][2] = 'Laxmi didi\n9000000055'; // row 4: speaker empty, local contact filled in C
  const sheet = makeSheet('28-Sep', 7, g);
  const gs = load([sheet], NOW);
  const r = gs.getState().rows.find(x => x.row === 4);
  assert.equal(r.speaker, '', 'row is open');
  gs.claimRow(r.row, r.fp, 'Priya', '9876543210');
  assert.equal(sheet.grid[3][1], 'Priya 9876543210');
  assert.equal(sheet.grid[3][2], 'Laxmi didi\n9000000055');
  gs.releaseRow(r.row, r.fp, 'Priya');
  assert.equal(sheet.grid[3][1], '');
  assert.equal(sheet.grid[3][2], 'Laxmi didi\n9000000055');
});

// ---- Multiple people per school, up to the row's slot count ----
function slotsGrid() {
  return [
    // Real 30-Sep titles (including the sheet's "neeeded" typo).
    ['S No', 'Sahaja Yoga ( IND)\n Speaker Name', 'Total volunteers needed', 'count of Volunteers still neeeded', 'Institution name'],
    ['1', '', '3', '', 'School X'],
    ['2', 'Ramesh\n9000000001', '2', '', 'School Y'],   // organiser entry, name and phone on two lines
    ['3', 'GOPI and Team', '3 volunteers', '', 'School Z'],   // organiser entry with no phone
    ['4', '', '', '', 'School W'],                            // blank total = 1
    ['5', '', '0', '', 'School V'],
  ];
}
const byRow = (s, n) => s.rows.find(r => r.row === n);

test('slots: totals, remaining and parsed assignees come from the sheet', () => {
  const gs = load([makeSheet('28-Sep', 8, slotsGrid())], NOW);
  const s = gs.getState();
  assert.equal(s.slotsHeader, 'Total volunteers needed');
  assert.deepEqual(s.rows.map(r => [r.total, r.remaining]), [[3, 3], [2, 1], [3, 2], [1, 1], [0, 0]]);
  assert.deepEqual(byRow(s, 3).assignees.map(a => [a.name, a.phone]), [['Ramesh', '9000000001']]);
});
test('slots: people fill a school up to its total, then it is full', () => {
  const sheet = makeSheet('28-Sep', 8, slotsGrid());
  const gs = load([sheet], NOW);
  const r = byRow(gs.getState(), 2);
  gs.claimRow(r.row, r.fp, 'Priya', '9876543210');
  gs.claimRow(r.row, r.fp, 'Ravi', '9123456789');
  gs.claimRow(r.row, r.fp, 'priya', '9876543210'); // same person again: no duplicate
  const s = gs.claimRow(r.row, r.fp, 'Asha', '9000000002');
  assert.equal(sheet.grid[1][1], 'Priya 9876543210\nRavi 9123456789\nAsha 9000000002');
  assert.equal(byRow(s, 2).remaining, 0);
  assert.throws(() => gs.claimRow(r.row, r.fp, 'Neha', '9000000003'), /No slots left: taken by Priya, Ravi, Asha\./);
});
test('slots: releasing removes only that person and keeps the others exactly', () => {
  const sheet = makeSheet('28-Sep', 8, slotsGrid());
  const gs = load([sheet], NOW);
  const r = byRow(gs.getState(), 3);
  gs.claimRow(r.row, r.fp, 'Priya', '9876543210');
  assert.equal(sheet.grid[2][1], 'Ramesh\n9000000001\nPriya 9876543210', 'appended under organiser entry');
  assert.throws(() => gs.releaseRow(r.row, r.fp, 'Ravi'), /Your name is not on this row/);
  const s = gs.releaseRow(r.row, r.fp, 'PRIYA');
  assert.equal(sheet.grid[2][1], 'Ramesh\n9000000001');
  assert.equal(byRow(s, 3).remaining, 1);
});
test('slots: an organiser entry without a phone stays a separate person', () => {
  const sheet = makeSheet('28-Sep', 8, slotsGrid());
  const gs = load([sheet], NOW);
  const r = byRow(gs.getState(), 4);
  gs.claimRow(r.row, r.fp, 'Priya', '9876543210');
  const s = gs.claimRow(r.row, r.fp, 'Ravi', '9123456789');
  assert.deepEqual(byRow(s, 4).assignees.map(a => a.name), ['GOPI and Team', 'Priya', 'Ravi']);
  assert.equal(byRow(s, 4).remaining, 0);
  gs.releaseRow(r.row, r.fp, 'Priya');
  assert.equal(sheet.grid[3][1], 'GOPI and Team\n\nRavi 9123456789');
  assert.deepEqual(byRow(gs.getState(), 4).assignees.map(a => a.name), ['GOPI and Team', 'Ravi']);
});
test('slots: blank means 1, zero means closed, and no slots column means 1 each', () => {
  const gs = load([makeSheet('28-Sep', 8, slotsGrid())], NOW);
  const s = gs.getState();
  const w = byRow(s, 5);
  gs.claimRow(w.row, w.fp, 'Priya', '9876543210');
  assert.throws(() => gs.claimRow(w.row, w.fp, 'Ravi', '9123456789'), /No slots left: taken by Priya\./);
  const v = byRow(s, 6);
  assert.throws(() => gs.claimRow(v.row, v.fp, 'Ravi', '9123456789'), /This school has no slots/);
  const plain = load([makeSheet('28-Sep', 9, screenshotGrid())], NOW).getState();
  assert.equal(plain.slotsHeader, '');
  assert.ok(plain.rows.every(r => r.total === 1));
});
test('slots: an edited slot count refuses the stale claim instead of overfilling', () => {
  const sheet = makeSheet('28-Sep', 8, slotsGrid());
  const gs = load([sheet], NOW);
  const r = byRow(gs.getState(), 2);
  sheet.grid[1][2] = '1'; gs._cache && Object.keys(gs._cache).forEach(k => delete gs._cache[k]);
  assert.throws(() => gs.claimRow(r.row, r.fp, 'Priya', '9876543210'), /edited or moved/);
});

test('still-needed column: kept up to date on claim and release', () => {
  const sheet = makeSheet('28-Sep', 8, slotsGrid());
  const gs = load([sheet], NOW);
  const r = byRow(gs.getState(), 2);
  gs.claimRow(r.row, r.fp, 'Priya', '9876543210');
  assert.equal(sheet.grid[1][3], 2);
  gs.claimRow(r.row, r.fp, 'Ravi', '9123456789');
  assert.equal(sheet.grid[1][3], 1);
  gs.claimRow(r.row, r.fp, 'Ravi', '9123456789'); // repeat claim: no change
  assert.equal(sheet.grid[1][3], 1);
  gs.releaseRow(r.row, r.fp, 'Priya');
  assert.equal(sheet.grid[1][3], 2);
  const w = byRow(gs.getState(), 5);
  gs.claimRow(w.row, w.fp, 'Asha', '9000000002');
  assert.equal(sheet.grid[4][3], 0, 'blank total counts as 1');
});
test('still-needed column: a second person with a stale page can still join', () => {
  const sheet = makeSheet('28-Sep', 8, slotsGrid());
  const gs = load([sheet], NOW);
  const r = byRow(gs.getState(), 2); // both load the page now
  gs.claimRow(r.row, r.fp, 'Priya', '9876543210'); // changes column B and the still-needed cell
  const s = gs.claimRow(r.row, r.fp, 'Ravi', '9123456789'); // same, older fingerprint
  assert.deepEqual(byRow(s, 2).assignees.map(a => a.name), ['Priya', 'Ravi']);
});
test('still-needed column: a formula there is never overwritten', () => {
  const g = slotsGrid(); g[1][3] = '=C2-1';
  const sheet = makeSheet('28-Sep', 8, g);
  const gs = load([sheet], NOW);
  const r = byRow(gs.getState(), 2);
  gs.claimRow(r.row, r.fp, 'Priya', '9876543210');
  assert.equal(sheet.grid[1][3], '=C2-1');
});

// ---- Real 30-Sep layout: all 21 column titles exactly as in the sheet export ----
// (names, phones and schools below are fake; the patterns match the real entries)
const SEP30_HEADERS = ["S No", "Sahaja Yoga ( IND)\n Speaker Name", "Local ( HYD) \n Sahaja Yogi", "Total volunteers needed", "count of Volunteers still neeeded", "Institution name", "Zone", "Branch / Address", "Principal Name", "Phone No", "RI", "Phone No", "Date", "Time", "Remarks", "No Student", "Distance from Ashram", "Direction ( E, W)", "Approval Obtained By Yogi/Yogini Name", "Approval Obtained By Yogi/Yogini Contact number", "Google map"];
function sep30Grid() {
  const row = (sno, speaker, total, school) => {
    const r = Array(SEP30_HEADERS.length).fill('');
    r[0] = sno; r[1] = speaker; r[3] = total; r[5] = school; r[6] = 'Zone 1'; r[12] = '30-Sep-26';
    return r;
  };
  return [
    SEP30_HEADERS,
    row('1', '', '2', 'School A'),
    row('2', '', '3', 'School B'),
    row('3', 'Asha Rao\n9000000001', '', 'School C'),     // name + phone on two lines
    row('4', 'Neha Singh 9000000002', '2', 'School D'),    // name + phone on one line
    row('5', 'Suresh', '2', 'School E'),                  // organiser name, no phone
    row('6', '12 sessions', '', 'School F'),               // a note typed into the speaker column
    row('7', '', '', 'School G'),                          // no total = 1 person
  ];
}
test('30-Sep layout: both volunteer columns found among the real 21 titles', () => {
  const s = load([makeSheet('28-Sep', 30, sep30Grid())], NOW).getState();
  assert.equal(s.headers.length, 21, 'all columns shown');
  assert.equal(s.slotsHeader, 'Total volunteers needed');
  assert.deepEqual(s.rows.map(r => [r.cells[0], r.assignees.length, r.total, r.remaining]),
    [['1', 0, 2, 2], ['2', 0, 3, 3], ['3', 1, 1, 0], ['4', 1, 2, 1], ['5', 1, 2, 1], ['6', 1, 1, 0], ['7', 0, 1, 1]]);
});
test('30-Sep layout: a full day of claims only ever changes columns B and E', () => {
  const original = sep30Grid();
  const sheet = makeSheet('28-Sep', 30, sep30Grid());
  const gs = load([sheet], NOW);
  const v = gs.getState();                                   // everyone loads the page together
  const r = sno => v.rows.find(x => x.cells[0] === sno);
  gs.claimRow(r('1').row, r('1').fp, 'Vol A', '9000000011');
  gs.claimRow(r('1').row, r('1').fp, 'Vol B', '9000000012'); // stale page, still joins
  assert.throws(() => gs.claimRow(r('1').row, r('1').fp, 'Vol C', '9000000013'), /No slots left: taken by Vol A, Vol B\./);
  assert.equal(sheet.grid[1][4], 0);
  gs.releaseRow(r('1').row, r('1').fp, 'vol a');
  assert.equal(sheet.grid[1][1], 'Vol B 9000000012');
  assert.equal(sheet.grid[1][4], 1);
  gs.claimRow(r('4').row, r('4').fp, 'Vol D', '9000000014');
  assert.equal(sheet.grid[4][1], 'Neha Singh 9000000002\nVol D 9000000014');
  gs.claimRow(r('5').row, r('5').fp, 'Vol E', '9000000015');
  assert.equal(sheet.grid[5][1], 'Suresh\n\nVol E 9000000015');
  assert.throws(() => gs.claimRow(r('6').row, r('6').fp, 'Vol F', '9000000016'), /No slots left: taken by 12 sessions\./);
  gs.claimRow(r('7').row, r('7').fp, 'Vol G', '9000000017');
  assert.equal(sheet.grid[7][4], 0);
  original.forEach((row, i) => row.forEach((c, j) => { if (j !== 1 && j !== 4) assert.equal(sheet.grid[i][j], c, `cell ${i},${j} changed`); }));
});
test('a day tab with only the header row shows no schools instead of an error', () => {
  const s = load([makeSheet('28-Sep', 31, [SEP30_HEADERS])], NOW).getState();
  assert.equal(s.rows.length, 0);
});

// ---- Picking a date ----
function dayTab(name, id) { return makeSheet(name, id, screenshotGrid()); }
test('date picker: lists today and later day tabs in date order, today first', () => {
  const gs = load([dayTab('1-Oct', 1), dayTab('27-Sep', 2), dayTab('29-Sep', 3), dayTab('Dummy-29-Sep', 4),
    dayTab('28-Sep', 5), makeSheet('Summary', 6, [['x']])], NOW);
  const s = gs.getState();
  assert.equal(s.tab, '28-Sep');
  assert.deepEqual(s.days.map(d => d.label), ['Mon 28-Sep (today)', 'Tue 29-Sep', 'Thu 1-Oct']);
  assert.equal(gs.getState('1-Oct').tab, '1-Oct');
});
test('date picker: past, unknown and non-day tabs cannot be picked', () => {
  const gs = load([dayTab('27-Sep', 2), dayTab('28-Sep', 5), makeSheet('Summary', 6, [['x']])], NOW);
  assert.throws(() => gs.getState('27-Sep'), /not available any more/);
  assert.throws(() => gs.getState('Summary'), /not available any more/);
  assert.throws(() => gs.getState('5-Nov'), /not available any more/);
});
test('date picker: with no tab for today, the next day is shown', () => {
  const gs = load([dayTab('27-Sep', 2), dayTab('30-Sep', 3), dayTab('29-Sep', 4)], NOW);
  assert.equal(gs.getState().tab, '29-Sep');
});
test('date picker: claims and releases go to the picked day only', () => {
  const today = dayTab('28-Sep', 5), later = dayTab('30-Sep', 7);
  const gs = load([today, later], NOW);
  const r = gs.getState('30-Sep').rows.find(x => !x.speaker);
  const s = gs.claimRow(r.row, r.fp, 'Priya', '9876543210', '30-Sep');
  assert.equal(s.tab, '30-Sep');
  assert.equal(later.grid[r.row - 1][1], 'Priya 9876543210');
  assert.equal(today.grid[r.row - 1][1], '', 'today untouched');
  gs.releaseRow(r.row, r.fp, 'Priya', '30-Sep');
  assert.equal(later.grid[r.row - 1][1], '');
});

// ---- Time clashes on the same day ----
function timeGrid() {
  return [
    ['S No', 'Sahaja Yoga ( IND)\n Speaker Name', 'Total volunteers needed', 'Institution name', 'Time'],
    ['1', '', '2', 'School A', '10.00 A.M'],
    ['2', '', '2', 'School B', '10:00:00'],          // same start as School A, written differently
    ['3', '', '2', 'School C', '11:00 AM to 12:00'],
    ['4', '', '2', 'School D', 'to be confirmed'],   // no time: never clashes
    ['5', '', '2', 'School E', ''],
    ['6', '', '2', 'School F', '3:30-4:30 PM'],
    ['7', '', '2', 'School G', '15:30:00'],
  ];
}
test('time clash: same person cannot take two schools starting at the same time', () => {
  const gs = load([makeSheet('28-Sep', 40, timeGrid())], NOW);
  const v = gs.getState(); const r = n => v.rows.find(x => x.cells[0] === String(n));
  assert.deepEqual(v.rows.map(x => x.start), ['10:00', '10:00', '11:00', '', '', '15:30', '15:30']);
  gs.claimRow(r(1).row, r(1).fp, 'Priya', '9876543210');
  assert.throws(() => gs.claimRow(r(2).row, r(2).fp, 'priya', '9876543210'),
    /Time clash: you are already on S No 1 \(School A\) at 10\.00 A\.M on 28-Sep/);
  gs.claimRow(r(2).row, r(2).fp, 'Ravi', '9123456789');          // someone else: fine
  gs.claimRow(r(3).row, r(3).fp, 'Priya', '9876543210');         // different time: fine
  gs.claimRow(r(4).row, r(4).fp, 'Priya', '9876543210');         // no time: fine
  gs.claimRow(r(5).row, r(5).fp, 'Priya', '9876543210');
  gs.claimRow(r(6).row, r(6).fp, 'Priya', '9876543210');
  assert.throws(() => gs.claimRow(r(7).row, r(7).fp, 'Priya', '9876543210'), /Time clash: .*S No 6 \(School F\)/);
  gs.releaseRow(r(1).row, r(1).fp, 'Priya');                     // free the 10:00 slot...
  const s = gs.claimRow(r(2).row, r(2).fp, 'Priya', '9876543210'); // ...then 10:00 at School B works
  assert.deepEqual(s.rows.find(x => x.cells[0] === '2').assignees.map(a => a.name), ['Ravi', 'Priya']);
});
test('time clash: the same time on a different day is fine', () => {
  const gs = load([makeSheet('28-Sep', 41, timeGrid()), makeSheet('29-Sep', 42, timeGrid())], NOW);
  const a = gs.getState('28-Sep').rows[0], b = gs.getState('29-Sep').rows[0];
  gs.claimRow(a.row, a.fp, 'Priya', '9876543210', '28-Sep');
  const s = gs.claimRow(b.row, b.fp, 'Priya', '9876543210', '29-Sep');
  assert.equal(s.rows[0].assignees[0].name, 'Priya');
});
test('time: tabs with two Time columns use the first one that has a value', () => {
  const g = [['S No', 'Speaker Name', 'Time', 'School', 'Time'], ['1', '', '', 'A', '2pmto3pm'], ['2', '', '9.30 AM', 'B', '11:00']];
  const s = load([makeSheet('28-Sep', 43, g)], NOW).getState();
  assert.deepEqual(s.rows.map(r => [r.timeText, r.start]), [['2pmto3pm', '14:00'], ['9.30 AM', '09:30']]);
});
test('time: start times read from the real free-text formats in the sheet', () => {
  const gs = load([makeSheet('28-Sep', 44, [['S No']])], NOW);
  const cases = { '09:00:00': '09:00', '10.30 A.M': '10:30', '3:30-4:30 PM': '15:30', ' 2pmto3pm. (STRICT TIMINGS) ': '14:00',
    '3:00:00 PM  - 12 sessions': '15:00', 'EVERYDAY 6:30 A.M': '06:30', 'to be confirmed': '', '12:30-1:30 PM': '12:30',
    '11.00 AM to 12.00 A.M': '11:00', '03:30:00': '15:30', 'After 4:00 PM': '16:00', '1 P.M to 2.00 P.M': '13:00',
    '06:00:00': '06:00', '13:45:00': '13:45', '8:30am-9:40am': '08:30', ' 2.40 - 3.40pm': '14:40', '': '' };
  for (const [text, want] of Object.entries(cases)) assert.equal(gs.startTime_(text), want, text);
});
