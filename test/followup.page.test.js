// Follow-up Program page (followup/Index.html) in a real browser against the simulated sheet. "Now" is Wed 7 Oct 2026, 05:00.
const test = require('node:test'), assert = require('node:assert');
const { chromium } = require('playwright-core');
const { load, makeSheet } = require('./harness');
const SHIM = `window.google = { script: { get run() {
  let ok = () => {}, fail = () => {};
  const r = new Proxy({}, { get: (_, k) => k === 'withSuccessHandler' ? (f => (ok = f, r)) : k === 'withFailureHandler' ? (f => (fail = f, r))
    : (...a) => window.gsCall(k, a).then(x => x.err ? fail(new Error(x.err)) : ok(x.ok)) });
  return r; } } };`;
const PH = ['Line ID', 'Day', 'Start', 'End', 'Frequency', 'Week of month', 'Day of month', 'Centre', 'Address', 'Google map',
  'Places', 'From', 'Until', 'Contact', 'Notes'];
const SH = ['Slot ID', 'Date', 'Day', 'Start', 'End', 'Centre', 'Address', 'Map', 'Contact', 'Places', 'Status', 'Volunteers',
  'Still needed', 'Cancellation notice sent', 'Notes'];
const line = o => PH.map(h => o[h] == null ? '' : o[h]);

test('follow-up page: calendar, select + repeat, confirmation, release, 12-hour rule, layouts', { timeout: 60000 }, async () => {
  const plan = makeSheet('Program plan', 1, [PH,
    line({ Day: 'Saturday', Start: '6:30 PM', End: '7:30 PM', Frequency: 'Weekly', Centre: 'Ameerpet', Address: 'Road 3',
      'Google map': 'https://maps.app.goo.gl/x', Places: '2', From: '2026-10-01', Until: '2026-12-31', Contact: 'Lakshmi 9000000009' }),
    line({ Day: 'Every day', Start: '4:00 PM', End: '5:00 PM', Frequency: 'Daily', Centre: 'Kukatpally', Places: '3', From: '2026-10-07',
      Until: '2026-10-31', Contact: 'Lakshmi 9000000009' })]);
  const slots = makeSheet('Slots', 2, [SH]);
  const gs = load([plan, slots], new Date(Date.UTC(2026, 9, 7, 5, 0)), 'followup/Code.gs');
  gs.generateSlots();
  gs.registerSlots(['P1-20261010'], 1, 'Gita', '9345678901');
  const row = id => slots.grid.find(r => r[0] === id);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
    const p = await ctx.newPage();
    p.setDefaultTimeout(8000);
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.exposeFunction('gsCall', (fn, a) => { try { return { ok: JSON.parse(JSON.stringify(gs[fn](...a))) }; } catch (e) { return { err: e.message }; } });
    await p.addInitScript(SHIM);
    await p.route('http://app.test/', r => r.fulfill({ contentType: 'text/html', body: gs.doGet().getContent() }));
    await p.goto('http://app.test/');

    // One week: Mon-Thu, then Fri-Sun + the week's total; today is Wednesday; past days are greyed and can't be tapped.
    const boxes = await p.locator('#calGrid .dbox').allInnerTexts();
    assert.equal(boxes.length, 8);
    assert.match(boxes[0], /^Mon\n5Oct\npast$/);
    assert.match(boxes[2], /^Today\n7\n1 open$/);
    assert.match(boxes[5], /^Sat\n10\n2 open$/, 'Saturday: the daily and the weekly session both have places');
    assert.match(boxes[7], /^This week\n6\nopen$/, "5 daily (Wed-Sun) + 1 Saturday");
    assert.equal(await p.locator('#calMonth').textContent(), 'October 2026');
    assert.ok(await p.locator('#prevWeek').isDisabled(), 'no going back before this week');
    assert.equal(await p.locator('.dayhead').count(), 14, 'the next 2 weeks are listed');
    assert.match(await p.locator('article[data-id="P1-20261010"]').innerText(), /6:30 PM – 7:30 PM\n1 of 2 left\nAmeerpet · Road 3\nOpen map\nGita · 9345678901/);

    await p.fill('#name', 'Asha'); await p.fill('#mobile', '98765 43210');
    // Weekly session: repeat is counted in dates; the confirmation lists every date before anything is written.
    await p.click('article[data-id="P1-20261010"] button[data-sel]');
    assert.ok(await p.isVisible('#bar'));
    assert.deepEqual(await p.locator('#repeat option').allTextContents(),
      ['Just this date', 'Same session, next 4 dates', 'Same session, next 8 dates', 'Same session, whole program']);
    await p.selectOption('#repeat', '4');
    await p.click('#register');
    await p.waitForSelector('#confirm:not([hidden])');
    assert.deepEqual(await p.locator('#confirmList > div > b').allTextContents(),
      ['Sat 10 Oct · 6:30 PM', 'Sat 17 Oct · 6:30 PM', 'Sat 24 Oct · 6:30 PM', 'Sat 31 Oct · 6:30 PM']);
    assert.equal(row('P1-20261017')[SH.indexOf('Volunteers')], '', 'nothing written before Confirm');
    await p.click('#confirmGo');
    await p.waitForSelector('#note:has-text("Registered: 4 booking(s).")');
    assert.equal(row('P1-20261017')[SH.indexOf('Volunteers')], 'Asha 9876543210');
    await p.waitForSelector('article[data-id="P1-20261010"] button[data-release]');
    assert.match(await p.locator('#calGrid .dbox').nth(5).innerText(), /● You/);

    // Release one date; the others stay booked.
    await p.click('article[data-id="P1-20261017"] button[data-release]');
    await p.waitForSelector('#note:has-text("Released: Asha.")');
    assert.equal(row('P1-20261017')[SH.indexOf('Volunteers')], '');
    assert.equal(row('P1-20261024')[SH.indexOf('Volunteers')], 'Asha 9876543210');

    // Daily session: repeat is counted in days. Today's 4 PM is under 12 hours away, so release is closed and shows the contact.
    await p.click('article[data-id="P2-20261007"] button[data-sel]');
    assert.equal(await p.locator('#repeat option').first().textContent(), 'Just this day');
    await p.click('#register');
    await p.waitForSelector('#confirm:not([hidden])');
    await p.click('#confirmGo');
    await p.waitForSelector('article[data-id="P2-20261007"] .closed');
    assert.match(await p.locator('article[data-id="P2-20261007"] .act').innerText(), /Release closed - under 12 h to go\.\s+Please call Lakshmi 9000000009/);
    assert.equal(await p.locator('article[data-id="P2-20261007"] a[href="tel:9000000009"]').count(), 1);

    // Next week and "Show 2 more weeks" load more dates; no sideways scrolling on a phone or a laptop.
    await p.click('#nextWeek');
    await p.waitForFunction(() => document.getElementById('calRange').textContent === '12 Oct – 18 Oct');
    await p.click('#more');
    await p.waitForSelector('#d-2026-10-31');
    for (const width of [320, 390, 1280]) {
      await p.setViewportSize({ width, height: 800 });
      assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'no sideways scroll at ' + width);
    }
    assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector('.cards')).gridTemplateColumns.split(' ').length), 3, 'three columns on a laptop');
    await p.setViewportSize({ width: 390, height: 1400 }); await p.evaluate(() => window.scrollTo(0, 0));
    if (process.env.SHOT) await p.screenshot({ path: process.env.SHOT });
    assert.deepEqual(errs, []);
  } finally {
    await browser.close();
  }
});
