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

  assert.equal(await a.locator('th').count(), 10, 'button + Slots left + Assigned + all 7 sheet columns');
  assert.match(await a.textContent('#note'), /No "Total volunteers needed" column/);
  assert.equal(await a.locator('button:text("Claim")').count(), 2);

  await a.locator('button:text("Claim")').first().click();
  await a.waitForSelector('text=Claimed');
  assert.equal(sheet.grid[3][1], 'Priya 9876543210');
  assert.equal(await a.locator('button:text("Release")').count(), 1);

  // Ravi's page is stale: still shows row 4 as open. His click must fail cleanly and refresh.
  await b.locator('button:text("Claim")').first().click();
  await b.waitForSelector('#status.err');
  assert.match(await b.textContent('#status'), /No slots left: taken by Priya/);
  await b.waitForFunction(() => document.querySelectorAll('button').length === 1);
  assert.equal(sheet.grid[3][1], 'Priya 9876543210', 'sheet unchanged by loser');

  await b.check('#openOnly');
  assert.equal(await b.locator('tr').count(), 2, 'header + 1 open row');

  await a.locator('button:text("Release")').click();
  await a.waitForSelector('text=Released.');
  assert.equal(sheet.grid[3][1], '');

  await a.fill('#mobile', '');
  await a.locator('button:text("Claim")').first().click();
  assert.match(await a.textContent('#status'), /mobile number/);

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

    await row1(a).locator('button:text("Claim")').click(); await a.waitForSelector('text=Claimed');
    const b = await user('Ravi', '9123456789');
    await row1(b).locator('button:text("Claim")').click(); await b.waitForSelector('text=Claimed');
    assert.equal(sheet.grid[1][1], 'Ramesh\n9000000001\nPriya 9876543210\nRavi 9123456789');
    assert.match(await row1(b).textContent(), /0 of 3/);
    assert.deepEqual(await row1(b).locator('.person').allTextContents(),
      ['1. Ramesh · 9000000001', '2. Priya · 9876543210', '3. Ravi · 9123456789'], 'one numbered, separated line per person');
    assert.equal(await row1(b).locator('.person').nth(1).evaluate(e => getComputedStyle(e).borderTopStyle), 'dashed');
    assert.equal(sheet.grid[1][4], 0, 'still-needed column updated');

    const c = await user('Neha', '9000000003');
    assert.equal(await row1(c).locator('button').count(), 0, 'full: no Claim button');
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
    assert.deepEqual(await p.$$eval('#day option', o => o.map(x => x.textContent)), ['Mon 28-Sep (today)', 'Wed 30-Sep']);
    await p.fill('#name', 'Priya'); await p.fill('#mobile', '9876543210');

    await p.selectOption('#day', '30-Sep');
    await p.waitForSelector('text=Day: 30-Sep');
    const row = n => p.locator('#grid tr').nth(n);
    await row(1).locator('button:text("Claim")').click(); await p.waitForSelector('text=Claimed');
    assert.equal(d30.grid[1][1], 'Priya 9876543210', 'written to the picked day');
    assert.equal(d28.grid[1][1], '', 'today untouched');
    assert.match(await row(2).textContent(), /Clashes with S No 1 \(10:00\)/);
    assert.equal(await row(2).locator('button').count(), 0, 'no Claim button on a clashing school');
    assert.equal(await row(3).locator('button:text("Claim")').count(), 1, 'other times still claimable');

    await p.selectOption('#day', '28-Sep');
    await p.waitForSelector('text=Day: 28-Sep');
    assert.equal(await row(2).locator('button:text("Claim")').count(), 1, 'same time on another day is fine');
    assert.deepEqual(errs, []);
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
