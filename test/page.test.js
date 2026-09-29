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
    await p.waitForSelector('text=Today: 28-Sep');
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
    ['1', 'Chandrakant\n9000000001', 'School Y', '3', ''],
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
      await p.waitForSelector('text=Today: 28-Sep');
      await p.fill('#name', name); await p.fill('#mobile', mobile);
      return p;
    };
    const row1 = p => p.locator('#grid tr').nth(1);
    const a = await user('Priya', '9876543210');
    assert.match(await a.textContent('#note'), /Places per school from column "Total volunteers needed"/);
    assert.match(await row1(a).textContent(), /2 of 3/);
    assert.match(await row1(a).textContent(), /Chandrakant · 9000000001/);

    await row1(a).locator('button:text("Claim")').click(); await a.waitForSelector('text=Claimed');
    const b = await user('Ravi', '9123456789');
    await row1(b).locator('button:text("Claim")').click(); await b.waitForSelector('text=Claimed');
    assert.equal(sheet.grid[1][1], 'Chandrakant\n9000000001\nPriya 9876543210\nRavi 9123456789');
    assert.match(await row1(b).textContent(), /0 of 3/);
    assert.equal(sheet.grid[1][4], 0, 'still-needed column updated');

    const c = await user('Neha', '9000000003');
    assert.equal(await row1(c).locator('button').count(), 0, 'full: no Claim button');
    await a.reload(); await a.waitForSelector('text=Today: 28-Sep');
    await row1(a).locator('button:text("Release")').click(); await a.waitForSelector('text=Released.');
    assert.equal(sheet.grid[1][1], 'Chandrakant\n9000000001\nRavi 9123456789');
    await c.reload(); await c.waitForSelector('text=Today: 28-Sep');
    assert.match(await row1(c).textContent(), /1 of 3/);
    await c.screenshot({ path: path.join(__dirname, 'slots-view.png') });
  } finally { await browser.close(); }
});
