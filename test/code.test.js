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
  assert.throws(() => gs.getState(), /No tab for today \(Mon 28 Sep 2026\)/);
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
    ['2', 'Chandrakant\n9000000001', '2', '', 'School Y'],   // organiser entry, name and phone on two lines
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
  assert.deepEqual(byRow(s, 3).assignees.map(a => [a.name, a.phone]), [['Chandrakant', '9000000001']]);
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
  assert.equal(sheet.grid[2][1], 'Chandrakant\n9000000001\nPriya 9876543210', 'appended under organiser entry');
  assert.throws(() => gs.releaseRow(r.row, r.fp, 'Ravi'), /Your name is not on this row/);
  const s = gs.releaseRow(r.row, r.fp, 'PRIYA');
  assert.equal(sheet.grid[2][1], 'Chandrakant\n9000000001');
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
