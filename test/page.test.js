// Two browser "users" share one simulated backend; verifies UI claim/race/release flows.
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright-core');
const { load, makeSheet, screenshotGrid } = require('./harness');
const html = fs.readFileSync(path.join(__dirname, '..', 'Index.html'), 'utf8');
const SHIM = `window.google = { script: { get run() {
  let ok = () => {}, fail = () => {};
  const r = new Proxy({}, { get: (_, k) => k === 'withSuccessHandler' ? (f => (ok = f, r)) : k === 'withFailureHandler' ? (f => (fail = f, r))
    : (...a) => window.gsCall(k, a).then(x => x.err ? fail(new Error(x.err)) : ok(x.ok)) });
  return r; } } };`;

test('two users in real browser', { timeout: 60000 }, async () => {
  const sheet = makeSheet('28-Sep', 3, screenshotGrid());
  const gs = load([sheet], new Date(Date.UTC(2026, 8, 28)));
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  try {
  const user = async (name, mobile) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
    const p = await ctx.newPage();
    p.setDefaultTimeout(8000);
    await p.exposeFunction('gsCall', (fn, a) => { try { return { ok: JSON.parse(JSON.stringify(gs[fn](...a))) }; } catch (e) { return { err: e.message }; } });
    await p.addInitScript(SHIM);
    await p.route('http://app.test/', r => r.fulfill({ contentType: 'text/html', body: html }));
    await p.goto('http://app.test/');
    await p.waitForSelector('text=Day: 28-Sep');
    await p.fill('#name', name); await p.fill('#mobile', mobile);
    return p;
  };
  const a = await user('Priya', '9876543210');
  const b = await user('Ravi', '9123456789');
  const errs = []; for (const p of [a, b]) p.on('pageerror', e => errs.push(e.message));

  const heads = await a.locator('#grid th').allTextContents();
  assert.equal(heads.length, 9, 'Sl.No + button + Slots left + SY Speaker Name + the 5 other sheet columns');
  assert.deepEqual(heads.slice(0, 4), ['Sl.No', '', 'Slots left', 'SY Speaker Name']);
  assert.ok(!heads.includes('S No'), 'serial column not repeated');
  assert.equal(await a.locator('tr[data-row="2"]').locator('td').first().textContent(), '1', 'serial number is the first cell');
  assert.ok(!heads.some(h => /Sahaja Yoga\s*Speaker Name/.test(h)), 'sheet speaker column not repeated');
  assert.match(await a.textContent('#note'), /No "Total volunteers needed" column/);
  assert.equal(await a.locator('button:text-is("Register")').count(), 2);

  await a.locator('button:text-is("Register")').first().click();
  await a.waitForSelector('text=Registered');
  assert.equal(sheet.grid[3][1], 'Priya 9876543210');
  assert.equal(await a.locator('button:text("Release")').count(), 1);

  // Ravi's page is stale: still shows row 4 as open. He is added too, and it is flagged as over the limit.
  await b.locator('button:text-is("Register")').first().click();
  await b.waitForSelector('text=over its limit by 1');
  assert.equal(sheet.grid[3][1], 'Priya 9876543210\nRavi 9123456789');
  assert.match(await b.locator('tr[data-row="4"]').textContent(), /Over by 1/);
  assert.equal(await b.locator('.person.extra').count(), 1);
  assert.match(await b.locator('.person.extra').textContent(), /Ravi · 9123456789 \(over limit\)/);
  assert.equal(await b.locator('.person.extra').evaluate(e => getComputedStyle(e).color), 'rgb(179, 38, 30)', 'red');
  await b.locator('tr[data-row="4"]').locator('button:text("Release")').click();
  await b.waitForSelector('text=Released.');

  await b.check('#openOnly');
  assert.equal(await b.locator('#grid tr').count(), 2, 'header + 1 open row');

  // Priya's own school is full: it sits under "My Registrations" (with Release), never in "All Schools".
  await a.check('#openOnly');
  assert.equal(await a.textContent('#mineTitle'), 'My Registrations (1)');
  assert.equal(await a.locator('#mine tr[data-row="4"] button:text("Release")').count(), 1, 'still releasable');
  assert.equal(await a.locator('#grid tr[data-row="4"]').count(), 0, 'not repeated in All Schools');
  assert.equal(await a.locator('#grid tr').count(), 2, 'Open only: header + the one open school');
  await a.uncheck('#openOnly');

  await a.locator('button:text("Release")').click();
  await a.waitForSelector('text=Released.');
  assert.equal(sheet.grid[3][1], '');

  await a.fill('#mobile', '');
  await a.locator('button:text-is("Register")').first().click();
  assert.match(await a.textContent('#status'), /mobile number/);
  await a.fill('#mobile', '98765');
  await a.locator('button:text-is("Register")').first().click();
  assert.match(await a.textContent('#status'), /Please enter a 10-digit mobile number/, 'caught on the page before sending');

  await a.screenshot({ path: path.join(__dirname, 'phone-view.png'), fullPage: true });
  assert.deepEqual(errs, []);
  } finally { await browser.close(); }
});

test('multi-slot school in real browser: two join, third sees it full, one leaves', { timeout: 60000 }, async () => {
  const grid = [
    ['S No', 'Sahaja Yoga ( IND)\nSpeaker Name', 'School Name', 'Total volunteers needed', 'count of Volunteers still neeeded'],
    ['1', 'Ramesh\n9000000001', 'School Y', '3', ''],
    ['2', '', 'School X', '1', ''],
  ];
  const sheet = makeSheet('28-Sep', 3, grid);
  const gs = load([sheet], new Date(Date.UTC(2026, 8, 28)));
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  try {
    const user = async (name, mobile) => {
      const p = await (await browser.newContext({ viewport: { width: 1280, height: 700 } })).newPage();
      p.setDefaultTimeout(8000);
      await p.exposeFunction('gsCall', (fn, a) => { try { return { ok: JSON.parse(JSON.stringify(gs[fn](...a))) }; } catch (e) { return { err: e.message }; } });
      await p.addInitScript(SHIM);
      await p.route('http://app.test/', r => r.fulfill({ contentType: 'text/html', body: html }));
      await p.goto('http://app.test/');
      await p.waitForSelector('text=Day: 28-Sep');
      await p.fill('#name', name); await p.fill('#mobile', mobile);
      return p;
    };
    const row1 = p => p.locator('tr[data-row="2"]');   // sheet row 2, in whichever section it is
    const a = await user('Priya', '9876543210');
    assert.match(await a.textContent('#note'), /Places per school from column "Total volunteers needed"/);
    assert.match(await row1(a).textContent(), /2 of 3/);
    assert.match(await row1(a).textContent(), /Ramesh · 9000000001/);

    await row1(a).locator('button:text-is("Register")').click(); await a.waitForSelector('text=Registered');
    const b = await user('Ravi', '9123456789');
    await row1(b).locator('button:text-is("Register")').click(); await b.waitForSelector('text=Registered');
    assert.equal(sheet.grid[1][1], 'Ramesh\n9000000001\nPriya 9876543210\nRavi 9123456789');
    assert.match(await row1(b).textContent(), /0 of 3/);
    assert.deepEqual(await row1(b).locator('.person').allTextContents(),
      ['1. Ramesh · 9000000001', '2. Priya · 9876543210', '3. Ravi · 9123456789'], 'one numbered, separated line per person');
    assert.deepEqual(await row1(b).locator('.person').nth(1).evaluate(e => { const c = getComputedStyle(e); return [c.borderTopStyle, c.borderTopWidth, c.whiteSpace]; }), ['solid', '2px', 'nowrap']);
    for (const box of await row1(b).locator('.person').evaluateAll(ps => ps.map(p => p.getClientRects().length && p.scrollHeight <= parseFloat(getComputedStyle(p).lineHeight) * 1.5)))
      assert.ok(box, 'each person fits on a single line');
    assert.equal(sheet.grid[1][4], 0, 'still-needed column updated');

    const c = await user('Neha', '9000000003');
    assert.deepEqual(await row1(c).locator('button').allTextContents(), ['Register (full)'], 'full: warning Register button');
    await a.reload(); await a.waitForSelector('text=Day: 28-Sep');
    await row1(a).locator('button:text("Release")').click(); await a.waitForSelector('text=Released.');
    assert.equal(sheet.grid[1][1], 'Ramesh\n9000000001\nRavi 9123456789');
    await c.reload(); await c.waitForSelector('text=Day: 28-Sep');
    assert.match(await row1(c).textContent(), /1 of 3/);
    await c.screenshot({ path: path.join(__dirname, 'slots-view.png') });
  } finally { await browser.close(); }
});

test('date picker and time-clash label in real browser', { timeout: 60000 }, async () => {
  const grid = () => [
    ['S No', 'Speaker Name', 'Total volunteers needed', 'Institution name', 'Time'],
    ['1', '', '2', 'School A', '10.00 A.M'],
    ['2', '', '2', 'School B', '10:00:00'],
    ['3', '', '2', 'School C', '11:00'],
  ];
  const d28 = makeSheet('28-Sep', 3, grid()), d30 = makeSheet('30-Sep', 4, grid());
  const gs = load([makeSheet('27-Sep', 2, grid()), d28, d30], new Date(Date.UTC(2026, 8, 28)));
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  try {
    const p = await (await browser.newContext({ viewport: { width: 1000, height: 700 } })).newPage();
    p.setDefaultTimeout(8000);
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.exposeFunction('gsCall', (fn, a) => { try { return { ok: JSON.parse(JSON.stringify(gs[fn](...a))) }; } catch (e) { return { err: e.message }; } });
    await p.addInitScript(SHIM);
    await p.route('http://app.test/', r => r.fulfill({ contentType: 'text/html', body: html }));
    await p.goto('http://app.test/');
    await p.waitForSelector('text=Day: 28-Sep');
    assert.deepEqual(await p.$$eval('#day option', o => o.map(x => x.textContent)), ['Sun 27-Sep (past)', 'Mon 28-Sep (today)', 'Wed 30-Sep']);
    await p.fill('#name', 'Priya'); await p.fill('#mobile', '9876543210');

    await p.selectOption('#day', '30-Sep');
    await p.waitForSelector('text=Day: 30-Sep');
    const row = n => p.locator('tr[data-row="' + (n + 1) + '"]');   // n-th school = sheet row n + 1
    await row(1).locator('button:text-is("Register")').click(); await p.waitForSelector('text=Registered');
    assert.equal(d30.grid[1][1], 'Priya 9876543210', 'written to the picked day');
    assert.equal(d28.grid[1][1], '', 'today untouched');
    assert.match(await row(2).textContent(), /Clashes with Sl\.No 1 \(10:00\)/);
    assert.equal(await row(2).locator('button').count(), 0, 'no Claim button on a clashing school');
    assert.equal(await row(3).locator('button:text-is("Register")').count(), 1, 'other times still claimable');

    await p.selectOption('#day', '28-Sep');
    await p.waitForSelector('text=Day: 28-Sep');
    assert.equal(await row(2).locator('button:text-is("Register")').count(), 1, 'same time on another day is fine');
    assert.deepEqual(errs, []);
    await p.screenshot({ path: path.join(__dirname, 'picker-view.png') });
  } finally { await browser.close(); }
});

test('map and web links in cells are clickable, other text stays plain', { timeout: 60000 }, async () => {
  const grid = [
    ['S No', 'Speaker Name', 'Institution name', 'Google map', 'Remarks'],
    ['1', '', 'School A', 'https://maps.app.goo.gl/dnAqPMzUPHFdHdCu6?g_st=ac', 'see https://example.org/info for details'],
    ['2', '', 'School B', 'https://maps.google.com/maps?q=17.4652273%2C78.3084288&z=17&hl=en', 'javascript:alert(1)'],
  ];
  const gs = load([makeSheet('28-Sep', 3, grid)], new Date(Date.UTC(2026, 8, 28)));
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  try {
    const p = await (await browser.newContext()).newPage();
    p.setDefaultTimeout(8000);
    await p.exposeFunction('gsCall', (fn, a) => { try { return { ok: JSON.parse(JSON.stringify(gs[fn](...a))) }; } catch (e) { return { err: e.message }; } });
    await p.addInitScript(SHIM);
    await p.route('http://app.test/', r => r.fulfill({ contentType: 'text/html', body: html }));
    await p.goto('http://app.test/');
    await p.waitForSelector('text=Day: 28-Sep');
    const links = await p.$$eval('#grid a', as => as.map(a => [a.textContent, a.getAttribute('href'), a.target, a.rel]));
    assert.deepEqual(links, [
      ['Open map', 'https://maps.app.goo.gl/dnAqPMzUPHFdHdCu6?g_st=ac', '_blank', 'noopener noreferrer'],
      ['https://example.org/info', 'https://example.org/info', '_blank', 'noopener noreferrer'],
      ['Open map', 'https://maps.google.com/maps?q=17.4652273%2C78.3084288&z=17&hl=en', '_blank', 'noopener noreferrer'],
    ]);
    assert.match(await p.locator('tr[data-row="2"]').textContent(), /see https:\/\/example\.org\/info for details/);
    assert.match(await p.locator('tr[data-row="3"]').textContent(), /javascript:alert\(1\)/, 'shown as plain text, not a link');
  } finally { await browser.close(); }
});

test('register others in real browser: list, over-limit in red, remove with ✕', { timeout: 60000 }, async () => {
  const grid = [
    ['S No', 'Speaker Name', 'Total volunteers needed', 'Institution name'],
    ['1', '', '2', 'School A'],
  ];
  const sheet = makeSheet('28-Sep', 3, grid);
  const gs = load([sheet], new Date(Date.UTC(2026, 8, 28)));
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  try {
    const p = await (await browser.newContext({ viewport: { width: 1100, height: 700 } })).newPage();
    p.setDefaultTimeout(8000);
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.exposeFunction('gsCall', (fn, a) => { try { return { ok: JSON.parse(JSON.stringify(gs[fn](...a))) }; } catch (e) { return { err: e.message }; } });
    await p.addInitScript(SHIM);
    await p.route('http://app.test/', r => r.fulfill({ contentType: 'text/html', body: html }));
    await p.goto('http://app.test/');
    await p.waitForSelector('text=Day: 28-Sep');
    await p.fill('#name', 'Priya'); await p.fill('#mobile', '');
    assert.equal(await p.isVisible('#others'), false, 'box hidden until ticked');
    await p.check('#showOthers');
    await p.uncheck('#includeMe');                                         // leader registers others only
    await p.fill('#others', 'Ravi 9123456789\nAsha 12345');
    await p.locator('button:text-is("Register")').click();
    assert.match(await p.textContent('#status'), /Line 2 of "Register others"/, 'checked on the page first');
    await p.fill('#others', 'Ravi 9123456789\nAsha 9000000002\nNeha 9000000003');
    await p.locator('button:text-is("Register")').click();
    await p.waitForSelector('text=over its limit by 1');
    assert.equal(sheet.grid[1][1], 'Ravi 9123456789 (via Priya)\nAsha 9000000002 (via Priya)\nNeha 9000000003 (via Priya)');
    const row = p.locator('tr[data-row="2"]');
    assert.match(await row.textContent(), /Over by 1 \(needs 2\)/);
    assert.deepEqual(await row.locator('.person.extra').allTextContents(), ['3. Neha · 9000000003 (over limit) · via Priya✕']);
    assert.equal(await row.locator('button.x').count(), 3, 'Priya can remove all three she added');
    await p.screenshot({ path: path.join(__dirname, 'others-view.png') });
    await row.locator('.person').nth(2).locator('button.x').click();
    await p.waitForSelector('text=Removed Neha.');
    assert.equal(sheet.grid[1][1], 'Ravi 9123456789 (via Priya)\nAsha 9000000002 (via Priya)');
    assert.equal(await p.locator('tr[data-row="2"]').locator('.person.extra').count(), 0, 'no longer over');
    assert.deepEqual(errs, []);
    await p.screenshot({ path: path.join(__dirname, 'picker-view.png') });
  } finally { await browser.close(); }
});

test('speaker picker in real browser: alphabetical, multi-select, and own name fills mobile', { timeout: 60000 }, async () => {
  const day = makeSheet('28-Sep', 3, [['S No', 'Speaker Name', 'Total volunteers needed', 'Institution name'], ['1', '', '5', 'School A']]);
  const sp = makeSheet('Speaker', 4, [
    ['Sr. No.', 'Speaker', 'Language', 'Mobile'],
    ['1', 'zara Khan', 'Hindi', '9000000012'], ['2', 'Anil Rao', 'Hindi', '9000000011'],
    ['3', 'Meera Das', 'Telugu', ''], ['4', 'Priya', 'English', '9876543210']]);
  const gs = load([day, sp], new Date(Date.UTC(2026, 8, 28)));
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  try {
    const p = await (await browser.newContext({ viewport: { width: 1100, height: 800 } })).newPage();
    p.setDefaultTimeout(8000);
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.exposeFunction('gsCall', (fn, a) => { try { return { ok: JSON.parse(JSON.stringify(gs[fn](...a))) }; } catch (e) { return { err: e.message }; } });
    await p.addInitScript(SHIM);
    await p.route('http://app.test/', r => r.fulfill({ contentType: 'text/html', body: html }));
    await p.goto('http://app.test/');
    await p.waitForSelector('text=Day: 28-Sep');

    await p.fill('#name', 'Priya'); await p.dispatchEvent('#name', 'change');
    assert.equal(await p.inputValue('#mobile'), '9876543210', 'own mobile filled from the list');
    assert.deepEqual(await p.$$eval('#speakerNames option', o => o.map(x => x.value)), ['Anil Rao', 'Priya', 'zara Khan']);
    await p.fill('#mobile', ''); await p.fill('#name', 'Meera Das'); await p.dispatchEvent('#name', 'change');
    assert.match(await p.textContent('#status'), /First time: please enter your 10-digit mobile/);
    await p.fill('#name', 'Priya'); await p.dispatchEvent('#name', 'change');
    assert.equal(await p.inputValue('#mobile'), '9876543210');

    await p.check('#showOthers');
    await p.click('#picker summary');
    assert.deepEqual(await p.locator('#pickList label').allTextContents(),
      [' Anil Rao · 9000000011', ' Meera Das (no mobile saved yet)', ' Priya · 9876543210', ' zara Khan · 9000000012'], 'alphabetical');
    await p.fill('#pickSearch', 'zar');
    assert.deepEqual(await p.locator('#pickList label').allTextContents(), [' zara Khan · 9000000012'], 'search');
    await p.locator('#pickList input[type=checkbox]').first().check();
    await p.fill('#pickSearch', '');
    await p.locator('#pickList input[type=checkbox]').first().check();     // Anil
    await p.locator('#pickList input[type=checkbox]').nth(1).check();      // Meera: no mobile saved yet
    assert.equal(await p.textContent('#pickCount'), '3');
    assert.equal(await p.locator('#pickList input.firstmobile').count(), 1, 'asked for Meera\'s number');

    await p.locator('button:text-is("Register")').click();
    assert.match(await p.textContent('#status'), /Please enter a 10-digit mobile for Meera Das/);
    await p.fill('#pickList input.firstmobile', '90000 00013');
    await p.locator('button:text-is("Register")').click();
    await p.waitForSelector('text=Registered');
    assert.equal(day.grid[1][1], 'Priya 9876543210\nzara Khan 9000000012 (via Priya)\nAnil Rao 9000000011 (via Priya)\nMeera Das 9000000013 (via Priya)');
    assert.equal(sp.grid[3][3], '9000000013', 'Meera\'s number saved to the Speaker tab');
    await p.waitForFunction(() => /Meera Das · 9000000013/.test(document.getElementById('pickList').textContent));
    assert.equal(await p.locator('#pickList input.firstmobile').count(), 0, 'not asked again');
    assert.equal(await p.textContent('#pickCount'), '3', 'still ticked under the saved entry');
    assert.deepEqual(errs, []);
    await p.screenshot({ path: path.join(__dirname, 'picker-view.png') });
  } finally { await browser.close(); }
});

test('past day and ended slots in real browser: greyed out, no buttons, hidden by "Open only"', { timeout: 60000 }, async () => {
  const grid = () => [
    ['S No', 'Speaker Name', 'Total volunteers needed', 'Institution name', 'Time'],
    ['1', '', '2', 'Early', '3:00 to 4:30 AM'],
    ['2', 'Vol A 9000000001', '2', 'Later', '10.00 A.M'],
  ];
  const gs = load([makeSheet('27-Sep', 2, grid()), makeSheet('28-Sep', 3, grid())], new Date(Date.UTC(2026, 8, 28, 5)));
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  try {
    const p = await (await browser.newContext({ viewport: { width: 1000, height: 700 } })).newPage();
    p.setDefaultTimeout(8000);
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.exposeFunction('gsCall', (fn, a) => { try { return { ok: JSON.parse(JSON.stringify(gs[fn](...a))) }; } catch (e) { return { err: e.message }; } });
    await p.addInitScript(SHIM);
    await p.route('http://app.test/', r => r.fulfill({ contentType: 'text/html', body: html }));
    await p.goto('http://app.test/');
    await p.waitForSelector('text=Day: 28-Sep');
    await p.fill('#name', 'Vol A'); await p.fill('#mobile', '9000000001');
    const rows = () => p.locator('#grid tr');
    assert.match(await rows().nth(1).getAttribute('class'), /past/);
    assert.equal(await rows().nth(1).locator('button').count(), 0, 'ended slot: no buttons');
    assert.match(await rows().nth(1).textContent(), /Ended/);
    assert.equal(await p.locator('#mine tr[data-row="3"] button:text-is("Release")').count(), 1, 'later slot still usable, under My Registrations');
    await p.check('#openOnly');
    assert.equal(await rows().count(), 1, 'Open only hides the ended slot from All Schools');
    assert.equal(await p.locator('#mine tr[data-row="3"]').isVisible(), true, 'your own school stays visible');
    await p.uncheck('#openOnly');

    await p.selectOption('#day', '27-Sep');
    await p.waitForSelector('text=Day: 27-Sep');
    assert.equal(await p.isVisible('#pastNote'), true);
    assert.equal(await p.isVisible('#showOthers'), false, 'no Register others on a past day');
    assert.equal(await p.locator('table.grid button').count(), 0, 'no buttons at all');
    assert.equal(await p.locator('table.grid tr.past').count(), 2);
    await p.screenshot({ path: path.join(__dirname, 'past-view.png') });
    await p.check('#openOnly');
    assert.equal(await rows().count(), 1, 'Open only shows nothing from a past day');
    assert.deepEqual(errs, []);
  } finally { await browser.close(); }
});

test('opens on today, and a page left open moves to the new today after midnight', { timeout: 60000 }, async () => {
  const grid = () => [['S No', 'Speaker Name', 'Institution name'], ['1', '', 'School A']];
  const clock = new Date(Date.UTC(2026, 8, 28, 23, 50));         // 28 Sep, 23:50
  const gs = load(['27-Sep', '28-Sep', '29-Sep', '30-Sep'].map((n, i) => makeSheet(n, i + 1, grid())), clock);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  try {
    const open = async () => {
      const p = await (await browser.newContext()).newPage();
      p.setDefaultTimeout(8000);
      await p.exposeFunction('gsCall', (fn, a) => { try { return { ok: JSON.parse(JSON.stringify(gs[fn](...a))) }; } catch (e) { return { err: e.message }; } });
      await p.addInitScript(SHIM);
      await p.route('http://app.test/', r => r.fulfill({ contentType: 'text/html', body: html }));
      await p.goto('http://app.test/');
      return p;
    };
    const p = await open(), q = await open();
    await p.waitForSelector('text=Day: 28-Sep');
    assert.equal(await p.inputValue('#day'), '28-Sep', 'opens on today, not the earlier past tab');
    await q.waitForSelector('text=Day: 28-Sep');
    await q.selectOption('#day', '30-Sep');                        // someone deliberately picks another date
    await q.waitForSelector('text=Day: 30-Sep');

    clock.setTime(Date.UTC(2026, 8, 29, 0, 5));                    // midnight passes
    for (const page of [p, q]) await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await p.waitForSelector('text=Day: 29-Sep');
    assert.equal(await p.inputValue('#day'), '29-Sep');
    assert.match(await p.locator('#day option:checked').textContent(), /\(today\)/);
    await q.waitForTimeout(500);
    assert.equal(await q.inputValue('#day'), '30-Sep', 'a date picked on purpose stays');
  } finally { await browser.close(); }
});

test('when today is over the page opens on the next day, and today can still be picked to look at', { timeout: 60000 }, async () => {
  const grid = t => [['S No', 'Speaker Name', 'Institution name', 'Time'], ['1', '', 'School A', t]];
  const clock = new Date(Date.UTC(2026, 8, 28, 16, 0));           // 28 Sep 16:00, after the 2-3pm slot
  const gs = load([makeSheet('28-Sep', 1, grid('2pm to 3pm')), makeSheet('29-Sep', 2, grid('10:00'))], clock);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  try {
    const p = await (await browser.newContext()).newPage();
    p.setDefaultTimeout(8000);
    await p.exposeFunction('gsCall', (fn, a) => { try { return { ok: JSON.parse(JSON.stringify(gs[fn](...a))) }; } catch (e) { return { err: e.message }; } });
    await p.addInitScript(SHIM);
    await p.route('http://app.test/', r => r.fulfill({ contentType: 'text/html', body: html }));
    await p.goto('http://app.test/');
    await p.waitForSelector('text=Day: 29-Sep');
    await p.selectOption('#day', '28-Sep');
    await p.waitForSelector('text=Day: 28-Sep');
    await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));   // a refresh
    await p.waitForTimeout(500);
    assert.equal(await p.inputValue('#day'), '28-Sep', 'stays on today when picked on purpose');
    assert.match(await p.locator('tr[data-row="2"]').textContent(), /Ended/);
  } finally { await browser.close(); }
});

test('language switch: opens in English; Telugu and Hindi translate the page and script messages', { timeout: 60000 }, async () => {
  const grid = () => [
    ['S No', 'Speaker Name', 'Total volunteers needed', 'Institution name', 'Time'],
    ['1', 'Vol A 9000000001', '1', 'School A', '10.00 A.M'],
    ['2', '', '2', 'School B', '10:00:00'],
  ];
  const gs = load([makeSheet('27-Sep', 1, grid()), makeSheet('28-Sep', 2, grid())], new Date(Date.UTC(2026, 8, 28, 5)));
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  try {
    const p = await (await browser.newContext({ viewport: { width: 1200, height: 700 } })).newPage();
    p.setDefaultTimeout(8000);
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.exposeFunction('gsCall', (fn, a) => { try { return { ok: JSON.parse(JSON.stringify(gs[fn](...a))) }; } catch (e) { return { err: e.message }; } });
    await p.addInitScript(SHIM);
    await p.route('http://app.test/', r => r.fulfill({ contentType: 'text/html', body: html }));
    await p.goto('http://app.test/');
    await p.waitForSelector('text=Day: 28-Sep');
    assert.equal(await p.inputValue('#lang'), 'en', 'opens in English');
    assert.equal(await p.textContent('#brand h1'), 'Hyderabad 2026 - Self Realization TourSchedule & Assignments');
    assert.ok((await p.getAttribute('#logo', 'src')).startsWith('data:image/png;base64,'), 'lotus logo embedded');
    assert.match(await p.textContent('#clock'), /^Sheet time: Mon 28 Sep 05:00 · v\d{4}-\d\d-\d\d\.\d+ · loaded in \d+\.\d s$/);

    await p.selectOption('#lang', 'te');
    assert.equal(await p.textContent('#title'), 'రోజు: 28-Sep');
    assert.equal(await p.textContent('#brandSub'), 'షెడ్యూల్ & కేటాయింపులు', 'title switches language too');
    assert.deepEqual(await p.$$eval('#day option', o => o.map(x => x.textContent)), ['ఆది 27-Sep (గడిచింది)', 'సోమ 28-Sep (ఈ రోజు)']);
    assert.equal(await p.getAttribute('#mobile', 'placeholder'), '10 అంకెలు');
    assert.deepEqual((await p.locator('th').allTextContents()).slice(0, 4), ['క్ర.సం.', '', 'మిగిలిన స్థానాలు', 'SY వక్త పేరు']);
    assert.equal(await p.locator('tr[data-row="3"]').locator('button').textContent(), 'నమోదు చేయండి');
    assert.match(await p.textContent('#pickSummary'), /^వక్తలను ఎంచుకోండి \(0 ఎంచుకున్నారు\)$/);

    // Vol A is on School A at 10:00; School B is also 10:00 -> the script refuses; message shown in Hindi.
    await p.selectOption('#lang', 'hi');
    await p.fill('#name', 'Vol A'); await p.fill('#mobile', '9000000001');
    await p.check('#showOthers'); await p.fill('#others', 'Vol B 9000000002');   // registering others: no clash label, script checks
    await p.locator('tr[data-row="3"]').locator('button').click();
    await p.waitForSelector('#status.err');
    assert.equal(await p.textContent('#status'),
      'समय टकराता है: आप पहले से S No 1 (School A) में हैं (28-Sep, 10.00 A.M)। किसी को नहीं जोड़ा गया। पहले वह नाम हटाएँ या कोई दूसरा समय चुनें।');
    assert.equal(await p.textContent('#title'), 'दिन: 28-Sep');

    await p.selectOption('#lang', 'en');
    assert.equal(await p.textContent('#title'), 'Day: 28-Sep');
    assert.equal(await p.locator('tr[data-row="3"]').locator('button').textContent(), 'Register');
    assert.match(await p.textContent('#updated'), /^Updated /, 'every line switches, including "Updated"');
    assert.deepEqual(errs, []);
  } finally { await browser.close(); }
});

test('demo video button: prominent; opens the Drive video for the page language (English, Telugu, Hindi) in a new tab; without Drive, plays that language here with fallback', { timeout: 60000 }, async () => {
  const gs = load([makeSheet('28-Sep', 1, [['S No', 'Speaker Name', 'Institution name'], ['1', '', 'School A']])], new Date(Date.UTC(2026, 8, 28, 5)));
  const DRIVE = /^\s*'https:\/\/drive\.google\.com\/[^']*',\n/gm;
  assert.equal((html.match(DRIVE) || []).length, 3, 'a Google Drive link for English, Telugu and Hindi');
  const first = lang => html.match(new RegExp('\\b' + lang + ": \\[\\s*'([^']+)'"))[1];
  assert.equal(new Set(['en', 'te', 'hi'].map(first)).size, 3, 'each language has its own video');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
    const hits = [];
    await ctx.route('https://drive.google.com/**', r => { hits.push('drive'); return r.fulfill({ contentType: 'text/html', body: 'drive player' }); });
    await ctx.route('https://cdn.jsdelivr.net/**', r => { hits.push('jsdelivr'); return r.fulfill({ status: 404, body: 'nope' }); });
    await ctx.route('https://raw.githubusercontent.com/**', r => { hits.push('raw'); return r.fulfill({ status: 404, body: 'nope' }); });
    const open = async body => {
      const p = await ctx.newPage();
      p.setDefaultTimeout(8000);
      await p.exposeFunction('gsCall', (fn, a) => { try { return { ok: JSON.parse(JSON.stringify(gs[fn](...a))) }; } catch (e) { return { err: e.message }; } });
      await p.addInitScript(SHIM);
      await p.route('http://app.test/', r => r.fulfill({ contentType: 'text/html', body }));
      await p.goto('http://app.test/');
      await p.waitForSelector('text=Day: 28-Sep');
      return p;
    };
    // As shipped: each language opens its own Drive video in Drive's player in a new tab; no in-page player.
    let p = await open(html);
    assert.match(await p.textContent('#demoBtn'), /Watch the 1-minute demo/);
    const btn = await p.locator('#demoBtn').boundingBox();
    assert.ok(btn.width > 300 && btn.height >= 36, 'full-width, easy to tap on a phone');
    const driveTab = async () => {
      const [tab] = await Promise.all([ctx.waitForEvent('page'), p.click('#demoBtn')]);
      await tab.waitForLoadState();
      const url = tab.url(); await tab.close(); return url;
    };
    assert.equal(await driveTab(), first('en'));
    await p.selectOption('#lang', 'hi');
    assert.match(await p.textContent('#demoBtn'), /1 मिनट का डेमो देखें/);
    assert.equal(await driveTab(), first('hi'), 'Hindi page: the Hindi video');
    await p.selectOption('#lang', 'te');
    assert.equal(await driveTab(), first('te'), 'Telugu page: the Telugu video');
    await p.selectOption('#lang', 'en');
    assert.equal(await driveTab(), first('en'), 'back in English: the English video again');
    assert.equal(await p.isVisible('#demoBox'), false);
    assert.deepEqual([...new Set(hits)], ['drive']);
    // Drive links removed: plays in the page, falling back to the second copy, in the page's language.
    hits.length = 0;
    p = await open(html.replace(DRIVE, ''));
    await p.click('#demoBtn');
    assert.equal(await p.isVisible('#demoVideo'), true);
    await p.waitForFunction(() => /^https:\/\/raw\.githubusercontent\.com\/.*\/docs\/demo\.mp4$/.test(document.getElementById('demoVideo').src));
    assert.deepEqual([...new Set(hits)], ['jsdelivr', 'raw'], 'tried the first copy, then the second');
    assert.match(await p.getAttribute('#demoLink', 'href'), /^https:\/\/cdn\.jsdelivr\.net\/gh\/MamtaMukeshK\/task-self-assign-sahaja-hyd@[0-9a-f]{40}\/docs\/demo\.mp4$/);
    assert.equal(await p.getAttribute('#demoVideo', 'playsinline'), '', 'plays inline on iPhones');
    await p.keyboard.press('Escape');
    assert.equal(await p.isVisible('#demoBox'), false);
    await p.selectOption('#lang', 'hi');
    await p.click('#demoBtn');
    await p.waitForFunction(() => /^https:\/\/raw\.githubusercontent\.com\/.*\/docs\/demo-hi\.mp4$/.test(document.getElementById('demoVideo').src));
    assert.match(await p.getAttribute('#demoLink', 'href'), /^https:\/\/cdn\.jsdelivr\.net\/gh\/MamtaMukeshK\/task-self-assign-sahaja-hyd@[0-9a-f]{40}\/docs\/demo-hi\.mp4$/);
    await p.click('#demoClose');
    assert.equal(await p.isVisible('#demoBox'), false);
    await p.selectOption('#lang', 'te');
    await p.click('#demoBtn');
    await p.waitForFunction(() => /^https:\/\/raw\.githubusercontent\.com\/.*\/docs\/demo-te\.mp4$/.test(document.getElementById('demoVideo').src));
    await p.click('#demoClose');
  } finally { await browser.close(); }
});

test('adaptive layout: phone cards (no sideways scroll, duplicates hidden, Details survives refresh); tablet cards show all; frozen columns on laptops', { timeout: 60000 }, async () => {
  const H = ['Sl.No', 'Speaker Name', 'Total volunteers needed', 'count of Volunteers still neeeded', 'Institution name', 'Date', 'Time',
    'Address', 'Google map', 'Contact Person', 'Contact Mobile', 'Remarks'];
  const gs = load([makeSheet('28-Sep', 1, [H,
    ['1', 'Ramesh 9000000001', '3', '2', 'School Y with a rather long name', '28-Sep-26', '2pm to 3pm', 'Plot 12, Madhapur', 'https://maps.app.goo.gl/abc', 'Mr. Rao', '9000000201', 'Hall on 2nd floor'],
    ['2', '', '1', '1', 'School X', '28-Sep-26', '4pm to 5pm', 'Kondapur', '', '', '', '']])], new Date(Date.UTC(2026, 8, 28, 5)));
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const body = html.replace('<head>', '<head><meta name="viewport" content="width=device-width, initial-scale=1">'); // added by doGet
  const open = async (width, height) => {
    const ctx = await browser.newContext({ viewport: { width, height }, isMobile: width < 700, hasTouch: width < 700 });
    const p = await ctx.newPage();
    p.setDefaultTimeout(8000);
    await p.exposeFunction('gsCall', (fn, a) => { try { return { ok: JSON.parse(JSON.stringify(gs[fn](...a))) }; } catch (e) { return { err: e.message }; } });
    await p.addInitScript(SHIM);
    await p.route('http://app.test/', r => r.fulfill({ contentType: 'text/html', body }));
    await p.goto('http://app.test/');
    await p.waitForSelector('text=Day: 28-Sep');
    return p;
  };
  try {
    const p = await open(390, 844);
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth), 390, 'nothing wider than the phone');
    const card = p.locator('tr[data-row="2"]');
    assert.equal(await card.evaluate(tr => getComputedStyle(tr).display), 'flex', 'rows are cards');
    assert.equal(await p.isVisible('#grid tr >> nth=0'), false, 'column titles hidden');
    for (const [cls, visible] of [['c-school', true], ['c-time', true], ['c-slots', true], ['c-addr', true], ['c-map', true], ['c-dup', false], ['c-more', false]]) {
      assert.equal(await card.locator('td.' + cls).first().isVisible(), visible, cls);
    }
    assert.equal(await card.locator('td.c-dup').count(), 3, 'both volunteer counts and Date are the duplicates');
    assert.equal(await card.locator('td.c-addr').getAttribute('data-label'), 'Address');
    assert.equal(await p.locator('tr[data-row="3"]').locator('td.c-toggle').count(), 0, 'no Details button when there are no details');
    await card.locator('td.c-toggle button').click();
    assert.equal(await card.locator('td.c-more', { hasText: 'Mr. Rao' }).isVisible(), true);
    assert.equal(await card.locator('td.c-toggle button').textContent(), 'Hide details ▴');
    await p.evaluate(() => refresh());
    await p.waitForTimeout(300);
    assert.equal(await p.locator('tr[data-row="2"]').locator('td.c-more', { hasText: 'Mr. Rao' }).isVisible(), true, 'still open after the automatic refresh');
    await p.selectOption('#lang', 'hi');
    assert.equal(await p.locator('tr[data-row="2"]').locator('td.c-toggle button').textContent(), 'विवरण छिपाएँ ▴');

    const tablet = await open(820, 1180);
    assert.equal(await tablet.evaluate(() => document.documentElement.scrollWidth), 820, 'nothing wider than the tablet');
    const tcard = tablet.locator('tr[data-row="2"]');
    assert.equal(await tcard.evaluate(tr => getComputedStyle(tr).display), 'flex', 'tablets get cards too');
    assert.equal(await tcard.locator('td.c-more', { hasText: 'Mr. Rao' }).isVisible(), true, 'details shown without a tap');
    assert.equal(await tcard.locator('td.c-toggle').isVisible(), false, 'no Details button on tablets');
    assert.equal(await tcard.locator('td.c-dup').first().isVisible(), false, 'duplicates still hidden');

    const tab = await open(1150, 800);
    assert.equal(await tab.locator('tr[data-row="2"]').evaluate(tr => getComputedStyle(tr).display), 'table-row', 'laptops keep the table');
    assert.equal(await tab.isVisible('td.c-toggle'), false);
    const xs = () => tab.evaluate(() => [...document.querySelectorAll('#grid tr:nth-child(2) td')].slice(0, 3).map(td => Math.round(td.getBoundingClientRect().left)));
    const before = await xs();
    await tab.evaluate(() => { document.getElementById('grid').parentNode.scrollLeft = 200; });
    assert.ok(await tab.evaluate(() => document.getElementById('grid').parentNode.scrollLeft) > 0, 'the table does scroll sideways');
    assert.deepEqual(await xs(), before, 'Sl.No, button and Slots left stay put');
    const lefts = await tab.evaluate(() => [...document.querySelectorAll('#grid th.stick')].map(th => [parseFloat(th.style.left), th.getBoundingClientRect().width]));
    lefts.slice(1).forEach(([left], i) => assert.ok(Math.abs(left - lefts[i][0] - lefts[i][1]) < 0.01, 'frozen columns sit edge to edge (no gaps)'));
  } finally { await browser.close(); }
});

test('My Registrations: your schools and the ones you registered others for move to the top section', { timeout: 60000 }, async () => {
  const sheet = makeSheet('28-Sep', 1, [['S No', 'Speaker Name', 'Total volunteers needed', 'Institution name'],
    ['1', '', '2', 'School A'], ['2', '', '2', 'School B'], ['3', 'Ravi 9123456789 (via Priya)', '2', 'School C']]);
  const gs = load([sheet], new Date(Date.UTC(2026, 8, 28, 5)));
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  try {
    const p = await (await browser.newContext({ viewport: { width: 390, height: 800 } })).newPage();
    p.setDefaultTimeout(8000);
    await p.exposeFunction('gsCall', (fn, a) => { try { return { ok: JSON.parse(JSON.stringify(gs[fn](...a))) }; } catch (e) { return { err: e.message }; } });
    await p.addInitScript(SHIM);
    await p.route('http://app.test/', r => r.fulfill({ contentType: 'text/html', body: html }));
    await p.goto('http://app.test/');
    await p.waitForSelector('text=Day: 28-Sep');
    assert.equal(await p.isVisible('#mineBox'), false, 'no name yet: no section');
    await p.fill('#name', 'Priya'); await p.fill('#mobile', '9876543210');
    assert.equal(await p.textContent('#mineTitle'), 'My Registrations (1)', 'School C: Priya registered Ravi there');
    assert.equal(await p.locator('#mine tr[data-row="4"] button.x').count(), 1, 'her ✕ for Ravi is in the section');
    assert.equal(await p.isVisible('#allTitle'), true);

    await p.locator('#grid tr[data-row="2"] button:text-is("Register")').click();
    await p.waitForSelector('text=Registered');
    assert.match(await p.textContent('#status'), /now at the top, under "My Registrations"/);
    assert.equal(await p.textContent('#mineTitle'), 'My Registrations (2)');
    assert.equal(await p.locator('#mine tr[data-row="2"]').count(), 1, 'moved to the top');
    assert.equal(await p.locator('#grid tr[data-row="2"]').count(), 0, 'and not repeated below');
    assert.match(await p.locator('#mine tr[data-row="2"]').getAttribute('class'), /flash/, 'highlighted where it went');
    await p.selectOption('#lang', 'te');
    assert.equal(await p.textContent('#mineTitle'), 'నా నమోదులు (2)');
    await p.selectOption('#lang', 'en');

    await p.locator('#mine tr[data-row="2"] button:text("Release")').click();
    await p.waitForSelector('text=Released.');
    assert.equal(await p.locator('#grid tr[data-row="2"]').count(), 1, 'back under All Schools');
    await p.fill('#name', 'Neha');
    assert.equal(await p.isVisible('#mineBox'), false, 'someone with nothing registered sees no section');
    assert.equal(await p.isVisible('#allTitle'), false);
  } finally { await browser.close(); }
});

test('speed: first view needs no server trip; loading message only while there is nothing to show; days seen before show at once', { timeout: 60000 }, async () => {
  const grid = () => [['S No', 'Speaker Name', 'Institution name'], ['1', '', 'School A']];
  const gs = load([makeSheet('28-Sep', 1, grid()), makeSheet('29-Sep', 2, grid())], new Date(Date.UTC(2026, 8, 28, 5)));
  const served = gs.doGet().getContent();                  // what doGet sends: page + first day
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  try {
    const p = await (await browser.newContext({ viewport: { width: 390, height: 800 } })).newPage();
    p.setDefaultTimeout(8000);
    const calls = [];
    let hold = null;                                       // lets the test keep a server answer waiting
    await p.exposeFunction('gsCall', async (fn, a) => {
      calls.push(fn + ':' + (a[0] || ''));
      if (hold) await hold;
      try { return { ok: JSON.parse(JSON.stringify(gs[fn](...a))) }; } catch (e) { return { err: e.message }; }
    });
    await p.addInitScript(SHIM);
    await p.route('http://app.test/', r => r.fulfill({ contentType: 'text/html', body: served }));
    await p.goto('http://app.test/');
    await p.waitForSelector('text=Day: 28-Sep');
    assert.deepEqual(calls, [], 'first day drawn without asking the server');
    assert.equal(await p.isVisible('#loadingBox'), false);
    assert.match(await p.textContent('#clock'), /loaded in \d+\.\d s/);

    let release; hold = new Promise(r => { release = r; });
    await p.selectOption('#day', '29-Sep');
    assert.equal(await p.isVisible('#loadingBox'), true, 'new day: clear loading message');
    assert.match(await p.textContent('#loadingBox'), /Loading schools…/);
    release(); hold = null;
    await p.waitForSelector('text=Day: 29-Sep');
    assert.equal(await p.isVisible('#loadingBox'), false);

    hold = new Promise(r => { release = r; });
    await p.selectOption('#day', '28-Sep');
    assert.equal(await p.textContent('#title'), 'Day: 28-Sep', 'a day seen before shows at once');
    assert.equal(await p.isVisible('#loadingBox'), false);
    release(); hold = null;
  } finally { await browser.close(); }
});

test('ongoing programs in real browser: drop-down entry, one card per program with both roles, Register asks the role, others, ended greyed, Telugu', { timeout: 60000 }, async () => {
  const head = ['Sl.No', 'Sahaja Yoga ( IND)\n Speaker Name', 'Total volunteers Needed', 'Number of Volunteers still Needed', 'Backup Yogis Name',
    'Backup yogis needed', 'Num of backup yogis still needed', 'Frequency', 'Start Date', 'End Date', 'Time', 'Days of the Week',
    'Institution name', 'Branch / Address', 'Google map', 'Remarks'];
  const ongoing = makeSheet('Ongoing', 2, [head,
    ['1', '', '1', '1', '', '1', '1', 'Weekly', new Date(Date.UTC(2026, 8, 15)), new Date(Date.UTC(2027, 2, 31)), '9.30 am', 'Mon, Wed', 'Triveni Talent School', 'Lingampally', '', 'Call first'],
    ['2', '', '2', '2', '', '1', '1', 'Weekly', '', '', '9.30 am', 'Wed', 'Unacademy', 'Beeramguda', '', ''],
    ['3', '', '2', '2', '', '1', '1', 'Weekly', '', '', '9.30 am', 'Tue', 'Sri Chaitanya', 'Ameerpet', '', ''],
    ['4', 'Asha 9000000001', '1', '0', '', '1', '1', 'Daily', '01/09/2026', '30/09/2026', '3 to 4pm', 'Mon to Fri', 'Old School', 'Kukatpally', '', ''],
    ['5', '', '1', '1', '', '0', '', 'Weekly', '', '', '11 am', 'Thu', 'No Backups School', 'Uppal', '', '']]);
  const gs = load([makeSheet('06-Oct', 1, screenshotGrid()), ongoing, makeSheet('Speaker', 3, [['Sr. No.', 'Speaker', 'Mobile']])],
    new Date(Date.UTC(2026, 9, 6, 5)));
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  try {
    const p = await (await browser.newContext({ viewport: { width: 390, height: 800 } })).newPage();
    p.setDefaultTimeout(8000);
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.exposeFunction('gsCall', (fn, a) => { try { return { ok: JSON.parse(JSON.stringify(gs[fn](...a))) }; } catch (e) { return { err: e.message }; } });
    await p.addInitScript(SHIM);
    await p.route('http://app.test/', r => r.fulfill({ contentType: 'text/html', body: html }));
    await p.goto('http://app.test/');
    await p.waitForSelector('text=Day: 06-Oct');
    assert.deepEqual(await p.locator('#day option').allTextContents(), ['Tue 06-Oct (today)', 'Ongoing programs'], 'opens on today; Ongoing last');
    await p.fill('#name', 'Priya'); await p.fill('#mobile', '9876543210');
    await p.selectOption('#day', 'Ongoing');
    await p.waitForSelector('text=Day: Ongoing');

    const heads = await p.locator('#grid th').allTextContents();
    assert.deepEqual(heads.slice(0, 5), ['Sl.No', '', 'Slots left', 'Volunteers', 'Dates & days'], 'same columns as a date tab, plus dates');
    assert.ok(!heads.includes('Backup Yogis Name'), 'sheet backup column not repeated');
    const card = p.locator('#grid tr[data-row="2"]');
    assert.equal(await card.locator('td.c-when').textContent(), '15 Sep 2026 to 31 Mar 2027 · Weekly · Mon, Wed');
    assert.deepEqual(await card.locator('td.c-slots .roleline').allTextContents(), ['Primary 1 of 1', 'Backup 1 of 1'], 'one badge, both roles');
    const top = sel => card.locator(sel).evaluate(e => e.getBoundingClientRect().top);
    assert.ok(await top('.roleline >> nth=1') > await top('.roleline >> nth=0'), 'Backup count on its own line, below Primary');
    assert.equal(await card.locator('td.c-dup', { hasText: 'Mon, Wed' }).isVisible(), false, 'days shown once, in the dates line');
    const btns = loc => loc.locator('td.c-btn button').allTextContents();

    await card.locator('button:text-is("Register")').click();
    assert.equal(await card.locator('.ask').textContent(), 'Register as:');
    assert.deepEqual(await btns(card), ['Primary', 'Backup', 'Cancel']);
    await card.locator('button:text-is("Cancel")').click();
    assert.deepEqual(await btns(card), ['Register'], 'Cancel puts the button back');
    await card.locator('button:text-is("Register")').click();
    await card.locator('button:text-is("Backup")').click();
    await p.waitForSelector('text=Registered as Backup.');
    assert.deepEqual([ongoing.grid[1][4], ongoing.grid[1][6], ongoing.grid[1][1]], ['Priya 9876543210', 0, ''], 'backup cells only');
    const mine = p.locator('#mine tr[data-row="2"]');
    assert.deepEqual(await btns(mine), ['Release'], 'no Register for the other role');
    assert.equal(await mine.locator('.person').textContent(), 'Priya · 9876543210Backup');
    assert.deepEqual(await mine.locator('td.c-slots .roleline').allTextContents(), ['Primary 1 of 1', 'Backup 0 of 1']);

    assert.match(await p.locator('#grid tr[data-row="3"] .clash').textContent(), /Clashes with Sl.No 1/, 'Wed 9.30 clashes');
    await p.locator('#grid tr[data-row="4"] button:text-is("Register")').click();               // Tue 9.30: no shared day
    await p.locator('#grid tr[data-row="4"] button:text-is("Primary")').click();
    await p.waitForSelector('text=My Registrations (2)');
    assert.deepEqual([ongoing.grid[3][1], ongoing.grid[3][3]], ['Priya 9876543210', 1]);
    await p.locator('#grid tr[data-row="6"] button:text-is("Register")').click();               // no backups there: no question
    await p.waitForSelector('text=My Registrations (3)');
    assert.equal(ongoing.grid[5][1], 'Priya 9876543210');
    assert.equal(await p.locator('#mine tr[data-row="6"] td.c-slots').textContent(), 'Primary 0 of 1', 'a role with no places is left out');

    await p.check('#showOthers'); await p.uncheck('#includeMe');
    await p.fill('#others', 'Ravi 9123456789\nAsha 9000000002');
    const wed = p.locator('#grid tr[data-row="3"]');
    await wed.locator('button:text-is("Register")').click();
    assert.equal(await wed.locator('.ask').textContent(), 'Register 2 people as:');
    await wed.locator('button:text-is("Backup")').click();
    await p.waitForSelector('text=Registered 2 people as Backup. Note: this school is now over its limit by 1');
    assert.equal(ongoing.grid[2][4], 'Ravi 9123456789 (via Priya)\nAsha 9000000002 (via Priya)');
    const wedMine = p.locator('#mine tr[data-row="3"]');
    assert.equal(await wedMine.locator('.person.extra').count(), 1, 'second backup over the limit, in red');
    await wedMine.locator('.person', { hasText: 'Ravi' }).locator('button.x').click();
    await p.waitForSelector('text=Removed Ravi.');
    assert.equal(ongoing.grid[2][4], 'Asha 9000000002 (via Priya)');
    await p.fill('#others', ''); await p.check('#includeMe'); await p.uncheck('#showOthers');

    const old = p.locator('#grid tr[data-row="5"]');
    assert.equal(await old.getAttribute('class'), 'past', 'ended on 30 Sep: greyed out');
    assert.equal(await old.locator('button').count(), 0);
    assert.match(await old.locator('td.c-btn').textContent(), /Ended/);
    await p.check('#openOnly');
    assert.equal(await p.locator('#grid tr[data-row="5"]').count(), 0, 'Open only hides the ended program');
    await p.uncheck('#openOnly');

    await p.selectOption('#lang', 'te');
    assert.equal(await p.locator('#day option:checked').textContent(), 'కొనసాగుతున్న కార్యక్రమాలు');
    assert.match(await mine.locator('td.c-when').textContent(), /^15 సెప్టెం 2026 నుండి 31 మార్చి 2027 వరకు/);
    assert.match(await mine.locator('td.c-slots').textContent(), /^ప్రధాన .*బ్యాకప్ /);
    assert.equal(await mine.locator('.roletag').textContent(), 'బ్యాకప్');
    await p.selectOption('#lang', 'en');

    await mine.locator('button:text("Release")').click();
    await p.waitForSelector('text=Released.');
    assert.deepEqual([ongoing.grid[1][4], ongoing.grid[1][6]], ['', 1]);

    await p.selectOption('#day', '06-Oct');
    await p.waitForSelector('text=Day: 06-Oct');
    assert.deepEqual((await p.locator('#grid th').allTextContents()).slice(0, 4), ['Sl.No', '', 'Slots left', 'SY Speaker Name'], 'date tab as before');
    assert.equal(await p.locator('#grid td.c-when, #grid .roletag').count(), 0);
    assert.equal(await p.locator('#grid tr[data-row="2"] td.c-slots').textContent(), '0 of 1', 'date tab badge unchanged');
    assert.deepEqual(errs, []);
  } finally { await browser.close(); }
});
