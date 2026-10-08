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
    assert.equal(await p.isVisible('#demoBtn'), false, 'demo button hidden until a video link is set (stage 4)');
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

// Opens the page as a volunteer whose name and mobile the browser remembers (as on a second visit).
async function openPage(browser, gs, width, name, mobile) {
  const p = await (await browser.newContext({ viewport: { width, height: 900 } })).newPage();
  p.setDefaultTimeout(8000);
  p.errs = []; p.on('pageerror', e => p.errs.push(e.message));
  await p.exposeFunction('gsCall', (fn, a) => { try { return { ok: JSON.parse(JSON.stringify(gs[fn](...a))) }; } catch (e) { return { err: e.message }; } });
  await p.addInitScript(SHIM);
  if (name) await p.addInitScript(([n, m]) => { localStorage.setItem('followupName', n); localStorage.setItem('followupMobile', m); }, [name, mobile]);
  await p.route('http://app.test/', r => r.fulfill({ contentType: 'text/html', body: gs.doGet().getContent() }));
  await p.goto('http://app.test/');
  return p;
}

test('follow-up page: register others, ✕ and Release all, My registrations, cancellation notice, Telugu and Hindi', { timeout: 60000 }, async () => {
  const plan = makeSheet('Program plan', 1, [PH,
    line({ Day: 'Saturday', Start: '6:30 PM', End: '7:30 PM', Frequency: 'Weekly', Centre: 'Ameerpet', Places: '2', From: '2026-10-01',
      Until: '2026-12-31', Contact: 'Lakshmi 9000000009' }),
    line({ Day: 'Every day', Start: '4:00 PM', Frequency: 'Daily', Centre: 'Kukatpally', Places: '3', From: '2026-10-07', Until: '2026-10-31' })]);
  const slots = makeSheet('Slots', 2, [SH]);
  const speakers = makeSheet('Speakers', 3, [['Sr. No.', 'Speaker', 'Mobile'], ['1', 'Ravi', '9123456789'], ['2', 'Meena', '']]);
  const gs = load([plan, slots, speakers], new Date(Date.UTC(2026, 9, 7, 5, 0)), 'followup/Code.gs');
  gs.generateSlots();
  gs.registerSlots(['P1-20261017', 'P1-20261024'], 1, 'Asha', '9876543210');
  slots.grid.find(r => r[0] === 'P1-20261024')[SH.indexOf('Status')] = 'Cancelled';
  const vols = id => slots.grid.find(r => r[0] === id)[SH.indexOf('Volunteers')];
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  try {
    const p = await openPage(browser, gs, 390, 'Asha', '9876543210');
    await p.waitForSelector('#alerts .alert');
    assert.equal(await p.textContent('#alerts'), "⚠ Cancelled: Sat 24 Oct, 6:30 PM, Ameerpet. Please don't go. Your other dates are unchanged.");
    assert.equal(await p.textContent('#mineBox'), 'My registrations: 2 date(s). Next: Sat 17 Oct, 6:30 PM, Ameerpet · youShow');

    // Register others only (as the tour test does): ticked speakers + typed lines; a bad line is caught on the page first.
    await p.click('article[data-id="P1-20261010"] button[data-sel]');
    assert.equal(await p.textContent('#who'), 'Who: Just me ▾');
    assert.equal(await p.evaluate(() => document.getElementById('who').closest('header') !== null &&
      document.getElementById('mobile').compareDocumentPosition(document.getElementById('who')) === Node.DOCUMENT_POSITION_FOLLOWING), true,
      '"Who" is at the top, right after the Mobile box');
    await p.click('#who');
    await p.uncheck('#includeMe');
    await p.click('#pickSummary');
    await p.locator('#pickList label', { hasText: 'Ravi' }).locator('input[type=checkbox]').check();
    await p.locator('#pickList label', { hasText: 'Meena' }).locator('input[type=checkbox]').check();
    await p.fill('#pickList input.firstmobile', '9234567890');
    assert.equal(await p.textContent('#pickSummary'), 'Choose speakers (2 selected)');
    await p.fill('#others', 'Neha 12345');
    await p.click('#whoDone');
    await p.click('#register');
    assert.match(await p.textContent('#note'), /^Line 1 of "Register others" should be a name/);
    await p.click('#who'); await p.fill('#others', 'Neha 9000000003'); await p.click('#whoDone');
    assert.deepEqual([await p.textContent('#barCount'), await p.textContent('#who')], ['3 people · 1 selected', 'Who: 3 people ▾']);
    await p.click('#register');
    await p.waitForSelector('#confirm:not([hidden])');
    assert.deepEqual(await p.locator('#confirmList .who').allTextContents(), ['Neha: booked', 'Ravi: booked', 'Meena: booked, over the limit']);
    await p.click('#confirmGo');
    await p.waitForSelector('#note:has-text("Registered: 3 booking(s).")');
    assert.equal(vols('P1-20261010'), 'Neha 9000000003 (via Asha)\nRavi 9123456789 (via Asha)\nMeena 9234567890 (via Asha)');
    assert.equal(speakers.grid[2][2], '9234567890', "Meena's first mobile saved to Speakers");
    const card = p.locator('article[data-id="P1-20261010"]');
    await p.waitForSelector('article[data-id="P1-20261010"] button[data-group]');
    assert.deepEqual(await card.locator('li.over').allTextContents(), ['Meena · 9234567890 (via Asha)✕'], 'over the limit in red');
    assert.equal(await card.locator('button.x').count(), 3);
    assert.equal(await card.locator('button[data-group]').textContent(), 'Release all 3 for this date');
    if (process.env.SHOT2) { await p.setViewportSize({ width: 390, height: 1900 }); await p.evaluate(() => window.scrollTo(0, 0)); await p.screenshot({ path: process.env.SHOT2 }); await p.setViewportSize({ width: 390, height: 900 }); }

    await card.locator('li', { hasText: 'Meena' }).locator('button.x').click();
    await p.waitForSelector('#note:has-text("Released: Meena.")');
    assert.equal(vols('P1-20261010'), 'Neha 9000000003 (via Asha)\nRavi 9123456789 (via Asha)');
    await p.click('article[data-id="P1-20261010"] button[data-group]');
    await p.waitForSelector('#note:has-text("Released: Neha, Ravi.")');
    assert.equal(vols('P1-20261010'), '');

    // Telugu, then Hindi with a translated server message (too many bookings: me + 4 typed + the 2 still-ticked speakers = 7 people x 24 daily dates).
    await p.selectOption('#lang', 'te');
    assert.equal(await p.textContent('#brand h1'), 'ఫాలో-అప్ ప్రోగ్రామ్');
    assert.match(await p.locator('#calGrid .dbox').nth(2).innerText(), /^ఈరోజు\n7\n/);
    assert.match(await p.textContent('#alerts'), /^⚠ రద్దు చేశారు: శని 24 అక్టో, 6:30 PM, Ameerpet\./);
    await p.selectOption('#lang', 'hi');
    await p.click('article[data-id="P2-20261008"] button[data-sel]');
    await p.click('#who'); await p.check('#includeMe');
    await p.fill('#others', 'Neha 9000000003\nGita 9345678901\nHari 9456789012\nUma 9567890123'); await p.click('#whoDone');
    await p.selectOption('#repeat', 'all');
    await p.click('#register');
    await p.waitForSelector('#note.err');
    assert.equal(await p.textContent('#note'), 'यह 168 पंजीकरण हैं (7 लोग x 24 तारीख़ें)। एक बार में अधिकतम 100। कृपया कम तारीख़ें या कम लोग चुनें।');
    assert.equal(await p.textContent('#register'), 'पंजीकरण करें');
    assert.deepEqual(p.errs, []);
  } finally { await browser.close(); }
});

test('follow-up setup guide: the Copy boxes hold the code files exactly', { timeout: 30000 }, async () => {
  const fs = require('fs'), path = require('path'), root = path.join(__dirname, '..');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  try {
    const p = await browser.newPage();
    await p.setContent(fs.readFileSync(path.join(root, 'followup', 'SETUP_GUIDE.html'), 'utf8'));
    assert.equal(await p.textContent('#code-gs'), fs.readFileSync(path.join(root, 'followup', 'Code.gs'), 'utf8'), 'rebuild with python3 tools/build_guide.py');
    assert.equal(await p.textContent('#index-html'), fs.readFileSync(path.join(root, 'followup', 'Index.html'), 'utf8'));
    assert.equal(await p.locator('h2').count(), 13);
  } finally { await browser.close(); }
});
