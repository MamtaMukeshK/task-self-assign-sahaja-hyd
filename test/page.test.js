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

  assert.equal(await a.locator('th').count(), 8, 'button column + all 7 sheet columns');
  assert.equal(await a.locator('button:text("Claim")').count(), 2);

  await a.locator('button:text("Claim")').first().click();
  await a.waitForSelector('text=Claimed');
  assert.equal(sheet.grid[3][1], 'Priya\n9876543210');
  assert.equal(await a.locator('button:text("Release")').count(), 1);

  // Ravi's page is stale: still shows row 4 as open. His click must fail cleanly and refresh.
  await b.locator('button:text("Claim")').first().click();
  await b.waitForSelector('#status.err');
  assert.match(await b.textContent('#status'), /Already taken by Priya/);
  await b.waitForFunction(() => document.querySelectorAll('button').length === 1);
  assert.equal(sheet.grid[3][1], 'Priya\n9876543210', 'sheet unchanged by loser');

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
