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
  assert.equal(today.grid[r.row-1][1], 'Priya Shah\n+91 98765 43210');
  assert.equal(today.grid[r.row-1][2], '', 'column C not written');
  assert.equal(sheets[0].writes + sheets[1].writes, 0, 'other tabs untouched');
  assert.equal(after.rows.find(x => x.row === r.row).speakerName, 'Priya Shah', 'returns fresh state (cache cleared)');
});
test('second person with a stale view loses the race cleanly', () => {
  const { gs, today } = setup(); const view = gs.getState(); const r = openRow(view);
  gs.claimRow(r.row, r.fp, 'Priya', '9876543210');
  assert.throws(() => gs.claimRow(r.row, r.fp, 'Ravi', '9123456789'), /Already taken by Priya/);
  assert.equal(today.grid[r.row-1][1], 'Priya\n9876543210');
});
test('same person re-clicking claim is harmless; can claim several rows', () => {
  const { gs } = setup(); const s = gs.getState(); const [a, b] = s.rows.filter(r => !r.speaker);
  gs.claimRow(a.row, a.fp, 'Priya', '9876543210');
  gs.claimRow(a.row, a.fp, 'priya', '9876543210');
  const s2 = gs.claimRow(b.row, b.fp, 'Priya', '9876543210');
  assert.equal(s2.rows.filter(r => r.speakerName === 'Priya').length, 2);
});
test('pre-filled rows (from organisers) cannot be claimed', () => {
  const { gs } = setup(); const r = gs.getState().rows[0];
  assert.throws(() => gs.claimRow(r.row, r.fp, 'Priya', '9876543210'), /Already taken by Asha Rao/);
});
test('release: only the claimer, and it clears both cells', () => {
  const { gs, today } = setup(); const r = openRow(gs.getState());
  gs.claimRow(r.row, r.fp, 'Priya', '9876543210');
  assert.throws(() => gs.releaseRow(r.row, r.fp, 'Ravi'), /Only Priya can release/);
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
  assert.equal(sheet.grid[r.row - 1][1], 'Priya\n9876543210', 'name and mobile in one cell');
  assert.equal(sheet.grid[r.row - 1][2], 'Local B\n9000000012', 'Local Sahaja Yogi column untouched');
  const mine = after.rows.find(x => x.row === r.row);
  assert.equal(mine.speakerName, 'Priya');
  assert.throws(() => gs.claimRow(r.row, r.fp, 'Ravi', '9123456789'), /Already taken by Priya\./);
  assert.throws(() => gs.releaseRow(r.row, r.fp, 'Ravi'), /Only Priya can release/);
  gs.releaseRow(r.row, r.fp, 'priya');
  assert.equal(sheet.grid[r.row - 1][1], '');
  const first = gs.getState().rows[0];
  assert.throws(() => gs.claimRow(first.row, first.fp, 'Ravi', '9123456789'), /Already taken by Asha Rao\./);
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
  assert.equal(sheet.grid[3][1], 'Priya\n9876543210');
  assert.equal(sheet.grid[3][2], 'Laxmi didi\n9000000055');
  gs.releaseRow(r.row, r.fp, 'Priya');
  assert.equal(sheet.grid[3][1], '');
  assert.equal(sheet.grid[3][2], 'Laxmi didi\n9000000055');
});
