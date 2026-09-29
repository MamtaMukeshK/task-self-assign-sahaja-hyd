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
test('only past tabs: the latest one is shown, view-only; no day tabs at all is a clear error', () => {
  const gs = load([makeSheet('26-Sep', 1, screenshotGrid()), makeSheet('27-Sep', 2, screenshotGrid())], NOW);
  const s = gs.getState();
  assert.deepEqual([s.tab, s.pastDay], ['27-Sep', true]);
  assert.throws(() => load([makeSheet('Summary', 3, [['x']])], NOW).getState(), /no day tabs \(named like 30-Sep\)/);
});
test('28-Sep layout: claim writes name + mobile into B only, never the "Speaker Mobile" column', () => {
  const { gs, today, sheets } = setup(); const r = openRow(gs.getState());
  const after = gs.claimRow(r.row, r.fp, '  Priya   Shah ', '+91 98765 43210');
  assert.equal(today.grid[r.row-1][1], 'Priya Shah 9876543210', '+91 and spaces removed');
  assert.equal(today.grid[r.row-1][2], '', 'column C not written');
  assert.equal(sheets[0].writes + sheets[1].writes, 0, 'other tabs untouched');
  assert.equal(after.rows.find(x => x.row === r.row).assignees[0].name, 'Priya Shah', 'returns fresh state (cache cleared)');
});
test('a full school still takes a second person, who is marked as over the limit', () => {
  const { gs, today } = setup(); const view = gs.getState(); const r = openRow(view);
  gs.claimRow(r.row, r.fp, 'Priya', '9876543210');
  const s = gs.claimRow(r.row, r.fp, 'Ravi', '9123456789');       // stale page, 1-place school
  assert.equal(today.grid[r.row-1][1], 'Priya 9876543210\nRavi 9123456789');
  const now = s.rows.find(x => x.row === r.row);
  assert.deepEqual([now.remaining, now.over], [0, 1]);
});
test('same person re-clicking claim is harmless; can claim several rows', () => {
  const { gs } = setup(); const s = gs.getState(); const [a, b] = s.rows.filter(r => !r.speaker);
  gs.claimRow(a.row, a.fp, 'Priya', '9876543210');
  gs.claimRow(a.row, a.fp, 'priya', '9876543210');
  const s2 = gs.claimRow(b.row, b.fp, 'Priya', '9876543210');
  assert.equal(s2.rows.filter(r => r.assignees.some(a => a.name === 'Priya')).length, 2);
});
test('pre-filled rows (from organisers) can be joined, over the limit', () => {
  const { gs, today } = setup(); const r = gs.getState().rows[0];
  const s = gs.claimRow(r.row, r.fp, 'Priya', '9876543210');
  assert.equal(today.grid[r.row-1][1], 'Asha Rao\n9000000001\nPriya 9876543210');
  assert.equal(s.rows[0].over, 1);
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
  for (const bad of ['12345', '98765+43210', '987654321', '98765432101', '+1 9876543210', '98765abcde', '', '+91 98765 4321'])
    assert.throws(() => gs.claimRow(r.row, r.fp, 'Priya', bad), /Please enter a 10-digit mobile number/, bad);
  assert.throws(() => gs.claimRow(1, r.fp, 'Priya', '9876543210'), /Invalid row/);
  assert.throws(() => gs.claimRow(999, r.fp, 'Priya', '9876543210'), /no longer exists/);
});
test('tab missing the speaker column errors loudly instead of guessing', () => {
  const gs = load([makeSheet('28-Sep', 1, [['S No', 'School'], ['1', 'A']])], NOW);
  assert.throws(() => gs.getState(), /no column in row 1 whose header contains "speaker" and "name"/);
});
test('reads are served from the shared cache', () => {
  const { gs } = setup(); gs.getState();
  assert.deepEqual(Object.keys(gs._cache).sort(), ['speakers', 'state:3'], 'day rows and speaker list are cached');
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
  assert.throws(() => gs.releaseRow(r.row, r.fp, 'Ravi'), /Your name is not on this row/);
  gs.releaseRow(r.row, r.fp, 'priya');
  assert.equal(sheet.grid[r.row - 1][1], '');
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
  const over = gs.claimRow(r.row, r.fp, 'Neha', '9000000003');     // a fourth person on a 3-place school
  assert.deepEqual([byRow(over, 2).remaining, byRow(over, 2).over], [0, 1]);
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
  assert.equal(byRow(gs.claimRow(w.row, w.fp, 'Ravi', '9123456789'), 5).over, 1, 'blank = 1 place, so Ravi is over');
  const v = byRow(s, 6);
  assert.throws(() => gs.claimRow(v.row, v.fp, 'Ravi', '9123456789'), /This school is closed \(its total is 0\)/);
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
  assert.equal(sheet.grid[1][4], 0);
  gs.claimRow(r('1').row, r('1').fp, 'Vol C', '9000000013');   // over the limit: added, still-needed stays 0
  assert.equal(sheet.grid[1][4], 0);
  gs.releaseRow(r('1').row, r('1').fp, 'vol a');
  assert.equal(sheet.grid[1][1], 'Vol B 9000000012\nVol C 9000000013');
  assert.equal(sheet.grid[1][4], 0);
  gs.releaseRow(r('1').row, r('1').fp, 'vol c');
  assert.equal(sheet.grid[1][4], 1);
  gs.claimRow(r('4').row, r('4').fp, 'Vol D', '9000000014');
  assert.equal(sheet.grid[4][1], 'Neha Singh 9000000002\nVol D 9000000014');
  gs.claimRow(r('5').row, r('5').fp, 'Vol E', '9000000015');
  assert.equal(sheet.grid[5][1], 'Suresh\n\nVol E 9000000015');
  assert.equal(gs.claimRow(r('6').row, r('6').fp, 'Vol F', '9000000016').rows.find(x => x.cells[0] === '6').over, 1);
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
test('date picker: lists all day tabs in date order (past ones marked), opening on today', () => {
  const gs = load([dayTab('1-Oct', 1), dayTab('27-Sep', 2), dayTab('29-Sep', 3), dayTab('Dummy-29-Sep', 4),
    dayTab('28-Sep', 5), makeSheet('Summary', 6, [['x']])], NOW);
  const s = gs.getState();
  assert.equal(s.tab, '28-Sep');
  assert.deepEqual(s.days.map(d => d.label), ['Sun 27-Sep (past)', 'Mon 28-Sep (today)', 'Tue 29-Sep', 'Thu 1-Oct']);
  assert.deepEqual(s.days.map(d => d.past), [true, false, false, false]);
  assert.equal(gs.getState('1-Oct').tab, '1-Oct');
});
test('date picker: past days can be viewed but not changed; unknown and non-day tabs cannot be picked', () => {
  const past = dayTab('27-Sep', 2);
  const gs = load([past, dayTab('28-Sep', 5), makeSheet('Summary', 6, [['x']])], NOW);
  const s = gs.getState('27-Sep');
  assert.equal(s.pastDay, true);
  assert.ok(s.rows.every(r => r.past), 'every row view-only');
  const open = s.rows.find(r => !r.speaker), taken = s.rows.find(r => r.speaker);
  assert.throws(() => gs.claimRow(open.row, open.fp, 'Priya', '9876543210', '27-Sep'), /27-Sep is over, so it can only be viewed now/);
  assert.throws(() => gs.releaseRow(taken.row, taken.fp, 'Asha Rao', '27-Sep'), /27-Sep is over/);
  assert.equal(past.grid[open.row - 1][1], '', 'nothing written');
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

// ---- Updated 30-Sep layout (29 Sep): the 20 column titles exactly as pasted from the sheet ----
const SEP30_V2_HEADERS = ["S No", "Sahaja Yoga ( IND)\n Speaker Name", "Local ( HYD) \n Sahaja Yogi", "Total volunteers needed", "count of Volunteers still neeeded", "Total No of Students", "Institution name", "Date", "Time", "Branch / Address", "Google map", "Principal Name", "RI", "Phone No", "Remarks", "Approval Obtained By Yogi/Yogini Name", "Approval Obtained By Yogi/Yogini Contact number", "Zone", "Distance from Ashram", "Direction ( E, W)"];
function sep30v2Grid() {
  const row = (sno, total, school, time) => {
    const r = Array(SEP30_V2_HEADERS.length).fill('');
    r[0] = sno; r[3] = total; r[6] = school; r[7] = '30-Sep-26'; r[8] = time; r[13] = '9000000099';
    return r;
  };
  return [
    SEP30_V2_HEADERS,
    row('1', '20', 'School A', ' 2pm to 3pm. (STRICT TIMINGS) '),
    row('2', '6', 'School B', '3:30 to 4:30 pm - 6 sessions'),
    row('3', '12', 'School C', '3:30 to 4:30 pm - 6 sessions'),
  ];
}
test('updated 30-Sep layout: capacity, times and clashes from the real column titles', () => {
  const sheet = makeSheet('28-Sep', 50, sep30v2Grid());
  const gs = load([sheet], NOW);
  const s = gs.getState();
  assert.equal(s.headers.length, 20);
  assert.equal(s.slotsHeader, 'Total volunteers needed', 'not "Total No of Students"');
  assert.deepEqual(s.rows.map(r => [r.total, r.remaining, r.start]), [[20, 20, '14:00'], [6, 6, '15:30'], [12, 12, '15:30']]);
  const [a, b, c] = s.rows;
  gs.claimRow(b.row, b.fp, 'Vol A', '9000000001');
  assert.equal(sheet.grid[2][1], 'Vol A 9000000001');
  assert.equal(sheet.grid[2][4], 5, 'still-needed column E');
  assert.throws(() => gs.claimRow(c.row, c.fp, 'Vol A', '9000000001'), /Time clash: you are already on S No 2 \(School B\)/);
  gs.claimRow(a.row, a.fp, 'Vol A', '9000000001');              // 2pm: no clash
  gs.claimRow(c.row, c.fp, 'Vol B', '9000000002');              // someone else at 3:30: fine
  assert.equal(sheet.grid[3][4], 11);
  const original = sep30v2Grid();
  original.forEach((r, i) => r.forEach((v, j) => { if (j !== 1 && j !== 4) assert.equal(sheet.grid[i][j], v, `cell ${i},${j}`); }));
});

test('mobile: exactly 10 digits, +91 / 91 / 0 prefix and spacing accepted, stored as 10 digits', () => {
  const gs = load([makeSheet('28-Sep', 60, [['S No']])], NOW);
  const ok = { '9876543210': '9876543210', '98765 43210': '9876543210', '98765-43210': '9876543210',
    '+91 98765 43210': '9876543210', '+919876543210': '9876543210', '919876543210': '9876543210',
    '09876543210': '9876543210', ' (987) 654-3210 ': '9876543210' };
  for (const [input, want] of Object.entries(ok)) assert.equal(gs.cleanMobile_(input), want, input);
});

// ---- Registering other people ----
test('others: a person can register a list of others, with or without themselves', () => {
  const sheet = makeSheet('28-Sep', 70, slotsGrid());
  const gs = load([sheet], NOW);
  const r = byRow(gs.getState(), 2);                                   // School X, 3 places
  gs.claimRow(r.row, r.fp, 'Priya', '9876543210', undefined, 'Ravi Kumar 91234 56789\nAsha, +91 90000 00002', true);
  assert.equal(sheet.grid[1][1], 'Priya 9876543210\nRavi Kumar 9123456789 (via Priya)\nAsha 9000000002 (via Priya)');
  const s = gs.getState();
  assert.deepEqual(byRow(s, 2).assignees.map(a => [a.name, a.phone, a.by]),
    [['Priya', '9876543210', ''], ['Ravi Kumar', '9123456789', 'Priya'], ['Asha', '9000000002', 'Priya']]);
  assert.equal(sheet.grid[1][3], 0, 'still-needed updated for all three');
  const w = byRow(s, 5);                                               // leader not going: only others
  gs.claimRow(w.row, w.fp, 'Priya', '', undefined, 'Neha 9000000003', false);
  assert.equal(sheet.grid[4][1], 'Neha 9000000003 (via Priya)');
});
test('others: going over the limit is allowed and counted', () => {
  const sheet = makeSheet('28-Sep', 71, slotsGrid());
  const gs = load([sheet], NOW);
  const r = byRow(gs.getState(), 3);                                   // School Y: 2 places, 1 organiser entry
  const s = gs.claimRow(r.row, r.fp, 'Priya', '9876543210', undefined, 'Ravi 9123456789\nAsha 9000000002', true);
  assert.deepEqual([byRow(s, 3).assignees.length, byRow(s, 3).remaining, byRow(s, 3).over], [4, 0, 2]);
  assert.equal(sheet.grid[2][3], 0);
});
test('others: bad lines, duplicates and nobody-to-add are handled before anything is written', () => {
  const sheet = makeSheet('28-Sep', 72, slotsGrid());
  const gs = load([sheet], NOW);
  const r = byRow(gs.getState(), 2);
  assert.throws(() => gs.claimRow(r.row, r.fp, 'Priya', '9876543210', undefined, 'Ravi 12345', true), /Line 1 of "Register others"/);
  assert.throws(() => gs.claimRow(r.row, r.fp, 'Priya', '9876543210', undefined, 'Ravi 9123456789\n9000000002', true), /Line 2 of "Register others"/);
  assert.throws(() => gs.claimRow(r.row, r.fp, 'Priya', '', undefined, '', false), /Nobody to register/);
  assert.equal(sheet.grid[1][1], '', 'nothing written');
  gs.claimRow(r.row, r.fp, 'Priya', '9876543210', undefined, 'priya 9876543210\nRavi 9123456789\nravi 9123456789', true);
  assert.equal(sheet.grid[1][1], 'Priya 9876543210\nRavi 9123456789 (via Priya)', 'each person once');
});
test('others: a time clash for anyone in the list stops the whole registration', () => {
  const sheet = makeSheet('28-Sep', 73, timeGrid());
  const gs = load([sheet], NOW);
  const v = gs.getState(); const r = n => v.rows.find(x => x.cells[0] === String(n));
  gs.claimRow(r(1).row, r(1).fp, 'Ravi', '9123456789');              // Ravi is on School A at 10:00
  assert.throws(() => gs.claimRow(r(2).row, r(2).fp, 'Priya', '9876543210', undefined, 'Asha 9000000002\nRavi 9123456789', true),
    /Time clash: Ravi is already on S No 1 \(School A\) at 10\.00 A\.M on 28-Sep\. Nobody was added/);
  assert.equal(sheet.grid[2][1], '', 'nobody added');
});
test('others: the registrar can remove people they added; others cannot', () => {
  const sheet = makeSheet('28-Sep', 74, slotsGrid());
  const gs = load([sheet], NOW);
  const r = byRow(gs.getState(), 2);
  gs.claimRow(r.row, r.fp, 'Priya', '9876543210', undefined, 'Ravi 9123456789\nAsha 9000000002', true);
  assert.throws(() => gs.removePerson(r.row, r.fp, 'Neha', 'Ravi'), /Only Ravi or Priya can remove Ravi/);
  gs.removePerson(r.row, r.fp, 'priya', 'Ravi');
  assert.equal(sheet.grid[1][1], 'Priya 9876543210\nAsha 9000000002 (via Priya)');
  gs.removePerson(r.row, r.fp, 'Asha', 'Asha');                        // people can remove themselves
  assert.equal(sheet.grid[1][1], 'Priya 9876543210');
  assert.throws(() => gs.removePerson(r.row, r.fp, 'Priya', 'Nobody'), /Nobody is not on this row/);
  assert.equal(sheet.grid[1][3], 2);
});

// ---- Speaker list: saved on registration, offered alphabetically on the page ----
// Same layout as the real "Speaker" tab: no mobile column, date columns, blank columns after.
function speakerTab() {
  return makeSheet('Speaker', 80, [
    ['Sr. No.', 'Speaker', 'Language', '23-Sep-26', '24-Sep-26', '', '', ''],
    ['1', 'zara Khan ', 'English, Hindi', 'Yes', '', '', '', ''],
    ['2', 'Anil Rao', 'Hindi', '', 'School', '', '', ''],
    ['3', 'meera Das', 'Telugu', '', '', '', '', ''],
  ]);
}
test('speakers: list read from the Speaker tab, alphabetical, mobile blank until saved', () => {
  const gs = load([makeSheet('28-Sep', 81, slotsGrid()), speakerTab()], NOW);
  assert.deepEqual(gs.getState().speakers, [
    { name: 'Anil Rao', mobile: '' }, { name: 'meera Das', mobile: '' }, { name: 'zara Khan', mobile: '' }]);
});
test('speakers: registering saves new people and fills missing mobiles, touching nothing else', () => {
  const sp = speakerTab();
  const original = sp.grid.map(r => r.slice());
  const gs = load([makeSheet('28-Sep', 82, slotsGrid()), sp], NOW);
  const r = byRow(gs.getState(), 2);
  const s = gs.claimRow(r.row, r.fp, 'Anil Rao', '9000000011', undefined, 'Zara khan 9000000012\nNew Person 9000000013', true);
  assert.equal(sp.grid[0][5], 'Mobile', 'Mobile column added in the first blank header cell');
  assert.equal(sp.grid[1][5], '9000000012', 'existing Zara gets her mobile');
  assert.equal(sp.grid[2][5], '9000000011', 'existing Anil gets his mobile');
  assert.deepEqual(Array.from(sp.grid[4].slice(0, 6), v => v ?? ''), [4, 'New Person', '', '', '', '9000000013'], 'new person added with next Sr. No.');
  original.forEach((row, i) => row.forEach((v, j) => { if (j !== 5) assert.equal(sp.grid[i][j], v, `cell ${i},${j} changed`); }));
  assert.deepEqual(s.speakers.map(x => x.name + ' ' + x.mobile),
    ['Anil Rao 9000000011', 'meera Das ', 'New Person 9000000013', 'zara Khan 9000000012'], 'alphabetical, ignoring capitals');
});
test('speakers: a known name with a different mobile is added as a new entry; same mobile is not repeated', () => {
  const sp = speakerTab();
  const gs = load([makeSheet('28-Sep', 83, slotsGrid()), sp], NOW);
  const v = gs.getState();
  gs.claimRow(byRow(v, 2).row, byRow(v, 2).fp, 'Anil Rao', '9000000011');
  gs.claimRow(byRow(v, 5).row, byRow(v, 5).fp, 'anil rao', '9000000011');          // same person again
  gs.claimRow(byRow(v, 4).row, byRow(v, 4).fp, 'Anil Rao', '9000000099');          // same name, other number
  assert.equal(sp.grid.filter(r => /anil rao/i.test(r[1] || '')).length, 2);
  assert.deepEqual(gs.getState().speakers.filter(x => /anil/i.test(x.name)).map(x => x.mobile), ['9000000011', '9000000099']);
});
test('speakers: without a Speaker tab one called "Speakers" is created', () => {
  const sheets = [makeSheet('28-Sep', 84, slotsGrid())];
  const gs = load(sheets, NOW);
  const r = byRow(gs.getState(), 2);
  gs.claimRow(r.row, r.fp, 'Priya', '9876543210');
  const created = sheets.find(s => s.getName() === 'Speakers');
  assert.ok(created);
  assert.deepEqual(created.grid.slice(0, 2).map(x => x.slice(0, 3)), [['Sr. No.', 'Speaker', 'Mobile'], [1, 'Priya', '9876543210']]);
});
test('speakers: a refused registration saves nobody', () => {
  const sp = speakerTab();
  const gs = load([makeSheet('28-Sep', 85, slotsGrid()), sp], NOW);
  const r = byRow(gs.getState(), 2);
  assert.throws(() => gs.claimRow(r.row, r.fp, 'Anil Rao', '9000000011', undefined, 'Bad Line 123', true), /Line 1/);
  assert.equal(sp.grid.length, 4);
  assert.equal(sp.grid[0][5], '');
});

// ---- Testing sheet of 29 Sep: 30-Sep titled "Sl.No"; Speaker tab already has "Mobile" in column C ----
test('testing-sheet layout: "Sl.No" serial title and an existing Speaker "Mobile" column are used as they are', () => {
  const day = makeSheet('28-Sep', 90, [
    ['Sl.No', 'Sahaja Yoga ( IND)\n Speaker Name', 'Local ( HYD) \n Sahaja Yogi', 'Total volunteers needed', 'count of Volunteers still neeeded', 'Institution name', 'Date', 'Time'],
    ['1', 'Vol A 9000000001\nVol B 9000000002', '', '20', '18', 'School A', '30-Sep-26', ' 2pm to 3pm. (STRICT TIMINGS) '],
    ['2', 'Vol C 9000000003', '', '6', '5', 'School B', '30-Sep-26', '3:30 to 4:30 pm - 6 sessions'],
    ['3', 'Vol D 9000000004', '', '12', '11', 'School C', '30-Sep-26', '3:30 to 4:30 pm - 12 sessions'],
  ]);
  const sp = makeSheet('Speaker', 91, [
    ['Sr. No.', 'Speaker', 'Mobile', 'Language', '30-Sep-26', ''],
    ['1', 'Anil Rao', '', 'Hindi', '', ''],
    ['42', 'Meera Das', '', 'Telugu', 'school', ''],
  ]);
  const gs = load([day, sp], NOW);
  const s = gs.getState();
  assert.deepEqual(s.rows.map(r => [r.start, r.remaining]), [['14:00', 18], ['15:30', 5], ['15:30', 11]]);
  assert.throws(() => gs.claimRow(s.rows[1].row, s.rows[1].fp, 'Vol D', '9000000004'), /Time clash: you are already on Sl\.No 3 \(School C\)/);
  gs.claimRow(s.rows[1].row, s.rows[1].fp, 'Anil Rao', '9000000011', undefined, 'New Person 9000000012', true);
  assert.equal(sp.grid[0].filter(h => h === 'Mobile').length, 1, 'no second Mobile column');
  assert.equal(sp.grid[1][2], '9000000011', 'saved into the existing Mobile column C');
  assert.deepEqual([0, 1, 2, 3].map(j => sp.grid[3][j] ?? ''), [43, 'New Person', '9000000012', ''], 'next Sr. No. after 42');
  assert.equal(sp.grid[2][4], 'school', 'date columns untouched');
  assert.equal(day.grid[2][4], 3, 'still-needed for Sl.No 2 = 6 - 3');
});

// ---- Slots whose end time has passed today are view-only ----
test('ended slots today: greyed out and refused once their end time has passed', () => {
  // NOW is 28 Sep 05:00 (test clock); times chosen around it.
  const g = [
    ['S No', 'Speaker Name', 'Total volunteers needed', 'Institution name', 'Time'],
    ['1', '', '2', 'Early', '3:00 to 4:30 AM'],        // ended 04:30
    ['2', '', '2', 'Just now', '4 AM to 5 AM'],        // ends 05:00 = now -> ended
    ['3', '', '2', 'Running', '4:30 AM to 6 AM'],      // still running -> open
    ['4', '', '2', 'Start only', '04:00 AM'],          // no end: 1 hour -> 05:00 -> ended
    ['5', '', '2', 'Later', '10.00 A.M'],
    ['6', '', '2', 'No time', 'to be confirmed'],      // unknown: never ended
  ];
  const sheet = makeSheet('28-Sep', 95, g);
  const gs = load([sheet], NOW);
  const s = gs.getState();
  assert.deepEqual(s.rows.map(r => [r.end, r.past]),
    [['04:30', true], ['05:00', true], ['06:00', false], ['05:00', true], ['11:00', false], ['', false]]);
  assert.equal(s.pastDay, false);
  assert.throws(() => gs.claimRow(s.rows[0].row, s.rows[0].fp, 'Priya', '9876543210'), /This slot has already ended \(3:00 to 4:30 AM\)/);
  gs.claimRow(s.rows[2].row, s.rows[2].fp, 'Priya', '9876543210');
  assert.equal(sheet.grid[3][1], 'Priya 9876543210');
  const later = load([makeSheet('29-Sep', 96, g)], NOW).getState();
  assert.ok(later.rows.every(r => !r.past), 'a later day is never greyed out');
});
test('end times read from the real free-text formats in the sheet', () => {
  const gs = load([makeSheet('28-Sep', 97, [['S No']])], NOW);
  const cases = { ' 2pm to 3pm. (STRICT TIMINGS) ': '15:00', '3:30 to 4:30 pm - 12 sessions': '16:30', '12:30-1:30 PM': '13:30',
    '11.00 AM to 12.00 A.M': '12:00', '10.00 AM to10.45 AM': '10:45', '9.15 to 9.45 AM ': '09:45', '12 to 1 pm': '13:00',
    '4:30 PM to 6:30 PM': '18:30', '3:00:00 PM  - 12 sessions': '16:00', '08:30:00': '09:30', 'After 4:00 PM': '17:00',
    '2pmto3pm': '15:00', '8:30am-9:40am': '09:40', '1.30 - 2.30pm': '14:30', 'to be confirmed': '', '': '' };
  for (const [text, want] of Object.entries(cases)) assert.equal(gs.endTime_(text), want, text);
});

// ---- Default day: today, unless every timed slot today has ended ----
test('default day: next day once all of today\'s timed slots are over; untimed ones do not hold it back', () => {
  const g = rows => [['S No', 'Speaker Name', 'Institution name', 'Time']].concat(rows.map((t, i) => [String(i + 1), '', 'School ' + i, t]));
  const at = (hh, mm) => new Date(Date.UTC(2026, 8, 28, hh, mm));   // 28 Sep (test clock, UTC)
  const tabs = rows => [makeSheet('27-Sep', 1, g(rows)), makeSheet('28-Sep', 2, g(rows)), makeSheet('29-Sep', 3, g(['10:00']))];
  const today = ['9.00 AM to 10.00 AM', '2pm to 3pm', 'to be confirmed', ''];
  assert.equal(load(tabs(today), at(14, 30)).getState().tab, '28-Sep', '2pm slot still running');
  const s = load(tabs(today), at(15, 0)).getState();
  assert.deepEqual([s.tab, s.defaultDay], ['29-Sep', '29-Sep'], 'all timed slots over -> next day');
  const viewToday = load(tabs(today), at(15, 0)).getState('28-Sep');
  assert.deepEqual([viewToday.tab, viewToday.pastDay, viewToday.rows.filter(r => r.past).length], ['28-Sep', false, 2], 'today can still be viewed');
  assert.equal(load(tabs(['to be confirmed', '']), at(23, 0)).getState().tab, '28-Sep', 'no timed slots: stay on today');
  const noNext = [makeSheet('28-Sep', 2, g(today))];
  assert.equal(load(noNext, at(23, 0)).getState().tab, '28-Sep', 'no later day: stay on today');
});

// ---- Real 29-Sep pattern: last slot "4:30 PM to 6:30 PM" -> next day opens from 18:30 India time ----
test('29-Sep pattern: opens on the next day once the last slot (4:30-6:30 PM) is over', () => {
  const g = [['S No', 'Speaker Name', 'Institution name', 'Time'],
    ['1', 'Vol A 9000000001', 'School A', '13:45:00'], ['2', '', 'School B', '3 PM to 4 PM\n4 PM to 5 PM'],
    ['3', '', 'School C', '3:00pm-5:00pm'], ['4', '', 'School D', '4:30 PM to 6:30 PM'], ['5', '', 'School E', 'EVERYDAY 6:30 A.M']];
  const at = (hh, mm) => load([makeSheet('29-Sep', 1, g), makeSheet('30-Sep', 2, g)], new Date(Date.UTC(2026, 8, 29, hh, mm))).getState();
  assert.equal(at(18, 29).tab, '29-Sep');
  assert.equal(at(18, 30).tab, '30-Sep');
  const late = at(23, 19);
  assert.deepEqual([late.tab, late.clock, late.version], ['30-Sep', 'Tue 29 Sep 23:19', '2026-09-29.4']);
});
test('time zone: India by default, the sheet\'s own setting only if TIME_ZONE is emptied', () => {
  const gs = load([makeSheet('28-Sep', 3, [['S No']])], NOW);
  assert.equal(gs.CONFIG.TIME_ZONE, 'Asia/Kolkata');
  const ss = { getSpreadsheetTimeZone: () => 'America/New_York' };
  assert.equal(gs.timeZone_(ss), 'Asia/Kolkata');
  gs.CONFIG.TIME_ZONE = '';
  assert.equal(gs.timeZone_(ss), 'America/New_York');
});
