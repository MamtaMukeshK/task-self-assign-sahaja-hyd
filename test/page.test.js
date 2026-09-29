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

  const heads = await a.locator('th').allTextContents();
  assert.equal(heads.length, 9, 'Sl.No + button + Slots left + SY Speaker Name + the 5 other sheet columns');
  assert.deepEqual(heads.slice(0, 4), ['Sl.No', '', 'Slots left', 'SY Speaker Name']);
  assert.ok(!heads.includes('S No'), 'serial column not repeated');
  assert.equal(await a.locator('#grid tr').nth(1).locator('td').first().textContent(), '1', 'serial number is the first cell');
  assert.ok(!heads.some(h => /Sahaja Yoga\s*Speaker Name/.test(h)), 'sheet speaker column not repeated');
  assert.match(await a.textContent('#note'), /No "Total volunteers needed" column/);
  assert.equal(await a.locator('button:text-is("Claim")').count(), 2);

  await a.locator('button:text-is("Claim")').first().click();
  await a.waitForSelector('text=Registered');
  assert.equal(sheet.grid[3][1], 'Priya 9876543210');
  assert.equal(await a.locator('button:text("Release")').count(), 1);

  // Ravi's page is stale: still shows row 4 as open. He is added too, and it is flagged as over the limit.
  await b.locator('button:text-is("Claim")').first().click();
  await b.waitForSelector('text=over its limit by 1');
  assert.equal(sheet.grid[3][1], 'Priya 9876543210\nRavi 9123456789');
  assert.match(await b.locator('#grid tr').nth(3).textContent(), /Over by 1/);
  assert.equal(await b.locator('.person.extra').count(), 1);
  assert.match(await b.locator('.person.extra').textContent(), /Ravi · 9123456789 \(over limit\)/);
  assert.equal(await b.locator('.person.extra').evaluate(e => getComputedStyle(e).color), 'rgb(179, 38, 30)', 'red');
  await b.locator('#grid tr').nth(3).locator('button:text("Release")').click();
  await b.waitForSelector('text=Released.');

  await b.check('#openOnly');
  assert.equal(await b.locator('tr').count(), 2, 'header + 1 open row');

  await a.locator('button:text("Release")').click();
  await a.waitForSelector('text=Released.');
  assert.equal(sheet.grid[3][1], '');

  await a.fill('#mobile', '');
  await a.locator('button:text-is("Claim")').first().click();
  assert.match(await a.textContent('#status'), /mobile number/);
  await a.fill('#mobile', '98765');
  await a.locator('button:text-is("Claim")').first().click();
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
      const p = await (await browser.newContext({ viewport: { width: 1000, height: 700 } })).newPage();
      p.setDefaultTimeout(8000);
      await p.exposeFunction('gsCall', (fn, a) => { try { return { ok: JSON.parse(JSON.stringify(gs[fn](...a))) }; } catch (e) { return { err: e.message }; } });
      await p.addInitScript(SHIM);
      await p.route('http://app.test/', r => r.fulfill({ contentType: 'text/html', body: html }));
      await p.goto('http://app.test/');
      await p.waitForSelector('text=Day: 28-Sep');
      await p.fill('#name', name); await p.fill('#mobile', mobile);
      return p;
    };
    const row1 = p => p.locator('#grid tr').nth(1);
    const a = await user('Priya', '9876543210');
    assert.match(await a.textContent('#note'), /Places per school from column "Total volunteers needed"/);
    assert.match(await row1(a).textContent(), /2 of 3/);
    assert.match(await row1(a).textContent(), /Ramesh · 9000000001/);

    await row1(a).locator('button:text-is("Claim")').click(); await a.waitForSelector('text=Registered');
    const b = await user('Ravi', '9123456789');
    await row1(b).locator('button:text-is("Claim")').click(); await b.waitForSelector('text=Registered');
    assert.equal(sheet.grid[1][1], 'Ramesh\n9000000001\nPriya 9876543210\nRavi 9123456789');
    assert.match(await row1(b).textContent(), /0 of 3/);
    assert.deepEqual(await row1(b).locator('.person').allTextContents(),
      ['1. Ramesh · 9000000001', '2. Priya · 9876543210', '3. Ravi · 9123456789'], 'one numbered, separated line per person');
    assert.deepEqual(await row1(b).locator('.person').nth(1).evaluate(e => { const c = getComputedStyle(e); return [c.borderTopStyle, c.borderTopWidth, c.whiteSpace]; }), ['solid', '2px', 'nowrap']);
    for (const box of await row1(b).locator('.person').evaluateAll(ps => ps.map(p => p.getClientRects().length && p.scrollHeight <= parseFloat(getComputedStyle(p).lineHeight) * 1.5)))
      assert.ok(box, 'each person fits on a single line');
    assert.equal(sheet.grid[1][4], 0, 'still-needed column updated');

    const c = await user('Neha', '9000000003');
    assert.deepEqual(await row1(c).locator('button').allTextContents(), ['Claim (full)'], 'full: warning Claim button');
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
    const row = n => p.locator('#grid tr').nth(n);
    await row(1).locator('button:text-is("Claim")').click(); await p.waitForSelector('text=Registered');
    assert.equal(d30.grid[1][1], 'Priya 9876543210', 'written to the picked day');
    assert.equal(d28.grid[1][1], '', 'today untouched');
    assert.match(await row(2).textContent(), /Clashes with Sl\.No 1 \(10:00\)/);
    assert.equal(await row(2).locator('button').count(), 0, 'no Claim button on a clashing school');
    assert.equal(await row(3).locator('button:text-is("Claim")').count(), 1, 'other times still claimable');

    await p.selectOption('#day', '28-Sep');
    await p.waitForSelector('text=Day: 28-Sep');
    assert.equal(await row(2).locator('button:text-is("Claim")').count(), 1, 'same time on another day is fine');
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
    assert.match(await p.locator('#grid tr').nth(1).textContent(), /see https:\/\/example\.org\/info for details/);
    assert.match(await p.locator('#grid tr').nth(2).textContent(), /javascript:alert\(1\)/, 'shown as plain text, not a link');
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
    await p.locator('button:text-is("Claim")').click();
    assert.match(await p.textContent('#status'), /Line 2 of "Register others"/, 'checked on the page first');
    await p.fill('#others', 'Ravi 9123456789\nAsha 9000000002\nNeha 9000000003');
    await p.locator('button:text-is("Claim")').click();
    await p.waitForSelector('text=over its limit by 1');
    assert.equal(sheet.grid[1][1], 'Ravi 9123456789 (via Priya)\nAsha 9000000002 (via Priya)\nNeha 9000000003 (via Priya)');
    const row = p.locator('#grid tr').nth(1);
    assert.match(await row.textContent(), /Over by 1 \(needs 2\)/);
    assert.deepEqual(await row.locator('.person.extra').allTextContents(), ['3. Neha · 9000000003 (over limit) · via Priya✕']);
    assert.equal(await row.locator('button.x').count(), 3, 'Priya can remove all three she added');
    await p.screenshot({ path: path.join(__dirname, 'others-view.png') });
    await row.locator('.person').nth(2).locator('button.x').click();
    await p.waitForSelector('text=Removed Neha.');
    assert.equal(sheet.grid[1][1], 'Ravi 9123456789 (via Priya)\nAsha 9000000002 (via Priya)');
    assert.equal(await p.locator('#grid tr').nth(1).locator('.person.extra').count(), 0, 'no longer over');
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

    await p.locator('button:text-is("Claim")').click();
    assert.match(await p.textContent('#status'), /Please enter a 10-digit mobile for Meera Das/);
    await p.fill('#pickList input.firstmobile', '90000 00013');
    await p.locator('button:text-is("Claim")').click();
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
    assert.equal(await rows().nth(2).locator('button:text-is("Release")').count(), 1, 'later slot still usable');
    await p.check('#openOnly');
    assert.deepEqual(await rows().evaluateAll(tr => tr.slice(1).map(r => r.cells[0].textContent)), ['2'], 'Open only hides the ended slot');
    await p.uncheck('#openOnly');

    await p.selectOption('#day', '27-Sep');
    await p.waitForSelector('text=Day: 27-Sep');
    assert.equal(await p.isVisible('#pastNote'), true);
    assert.equal(await p.isVisible('#showOthers'), false, 'no Register others on a past day');
    assert.equal(await p.locator('#grid button').count(), 0, 'no buttons at all');
    assert.equal(await p.locator('#grid tr.past').count(), 2);
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
    assert.match(await p.locator('#grid tr').nth(1).textContent(), /Ended/);
  } finally { await browser.close(); }
});
