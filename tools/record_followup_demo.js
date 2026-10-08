// Records the Follow-up Program demo (phone screen + live "Slots" sheet panel) with the real followup/Index.html and
// followup/Code.gs on the simulated sheet. Usage (from tools/): node record_followup_demo.js [en|te|hi]
// Needs the voice files first (voiceover/make_voice*.py followup/), then: cd voiceover && python3 mix.py <ffmpeg> <lang> followup
// Frame, cursor and cards are copied from record_demo.js; captions come from the approved docs/followup/demo-script.md.
const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const REPO = path.resolve(__dirname, '..');
const { load, makeSheet } = require(REPO + '/test/harness.js');
const FS = __dirname + '/node_modules/@fontsource/';
const LANG = process.argv[2] || 'en';
const VO = __dirname + '/voiceover/followup/' + (LANG === 'en' ? '' : LANG + '/');
const OUT = __dirname + (LANG === 'en' ? '/followup-demo.webm' : '/followup-demo-' + LANG + '.webm');

// ---- Words shown in the video: the approved caption table (docs/followup/demo-script.md, part A) ----
const DOC = fs.readFileSync(REPO + '/docs/followup/demo-script.md', 'utf8');
const COL = { en: 1, te: 2, hi: 3 }[LANG];
const row = key => DOC.split('\n').find(l => l.startsWith('| ' + key + ' |')).split(' | ')[COL].replace(/ \|$/, '').trim();
const split = (s, last) => { const i = last ? s.lastIndexOf(' · ') : s.indexOf(' · '); return [s.slice(0, i), s.slice(i + 3)]; };
const T = { step: { en: 'Step', te: 'దశ', hi: 'चरण' }[LANG], langs: { en: ['te', 'hi', 'en'], te: ['en', 'hi', 'te'], hi: ['en', 'te', 'hi'] }[LANG],
  caps: [1, 2, 3, 4, 5, 6, 7, 8].map(n => row(n)), title: split(row('Title card')), end: split(row('End card'), true), sheet: split(row('Sheet panel'), true) };

// ---- Demo data: the user's sample sheet (2026-10-08) with every phone number replaced by a made-up one ----
const DATA = {"Program plan": [["Line ID", "Day of the Week", "Start Time", "End Time", "Frequency", "Week of month", "Day of month", "Institution Name", "Address", "Google map", "Volunteers Needed", "From", "Until", "Principal Contact", "Sahaji Contact", "Notes"], ["P1", "Saturday", "6:30 PM", "7:30 PM", "Weekly", "", "", "Ameerpet Centre", "Road 3, Ameerpet", "https://maps.google.com/?q=Ameerpet%2C%20Hyderabad", "4", "2026-10-01", "2026-12-31", "Pradeep Reddy 9000000021", "Padma 9000000022", ""], ["P2", "Every Day", "7:00 AM", "7:45 AM", "Daily", "", "", "Kukatpally Centre", "KPHB Colony", "https://maps.google.com/?q=KPHB%20Colony%2C%20Hyderabad", "2", "2026-10-12", "2026-10-25", "Kasipati 9000000023", "Shanti 9000000024", ""], ["P3", "", "6:30 PM", "7:30 PM", "Daily, weekdays only (Mon-Fri)", "", "", "Dilsukhnagar Centre", "Near the bus stand", "https://maps.google.com/?q=Dilsukhnagar%2C%20Hyderabad", "2", "2026-10-12", "2026-11-30", "Lakshmi 9000000025", "Padma 9000000022", ""], ["P4", "Sunday", "10:00 AM", "11:00 AM", "Every 2 weeks", "", "", "Secunderabad Centre", "SP Road", "https://maps.google.com/?q=Secunderabad%2C%20Hyderabad", "3", "2026-10-04", "", "Suresh 9000000026", "Padma 9000000022", "No Until date: keeps 12 weeks ahead"], ["P5", "Saturday", "4:00 PM", "5:30 PM", "Monthly, same weekday", "2nd", "", "Gachibowli Centre", "", "https://maps.google.com/?q=Gachibowli%2C%20Hyderabad", "5", "2026-10-01", "2027-03-31", "Lakshmi 9000000025", "Padma 9000000022", ""], ["P6", "", "5:00 PM", "6:00 PM", "Monthly, same date", "", "15", "Madhapur Centre", "", "https://maps.google.com/?q=Madhapur%2C%20Hyderabad", "2", "2026-10-01", "2027-03-31", "Suresh 9000000026", "Padma 9000000022", ""], ["P7", "", "11:00 AM", "12:30 PM", "Custom", "", "", "Begumpet Centre", "", "https://maps.google.com/?q=Begumpet%2C%20Hyderabad", "6", "2026-11-14", "", "Lakshmi 9000000025", "Padma 9000000022", "Children's Day programme"]], "Speakers": [["Sr. No.", "Speaker", "Mobile"], ["1", "Asha Rao", "9000000027"], ["2", "Ravi Kumar", "9000000028"], ["3", "Meena Iyer", ""], ["4", "Gita Sharma", "9000000029"], ["5", "Hari Prasad", "9000000030"]]};
const SH = ['Slot ID', 'Date', 'Day', 'Start Time', 'End Time', 'Institution Name', 'Address', 'Map', 'Principal Contact', 'Sahaji Contact',
  'Volunteers Needed', 'Status', 'Volunteers', 'Still needed', 'Cancellation notice sent', 'Notes'];
const plan = makeSheet('Program plan', 1, DATA['Program plan'].map((r, i) => i ? [''].concat(r.slice(1)) : r)), slots = makeSheet('Slots', 2, [SH]);
const gs = load([plan, slots, makeSheet('Speakers', 3, DATA.Speakers)], new Date(Date.UTC(2026, 9, 12, 6, 0)), 'followup/Code.gs'); // Mon 12 Oct, 6 AM
gs.generateSlots();
gs.registerSlots(['P2-20261012'], 1, 'Asha Rao', '9000000027');      // today 7 AM: release already closed
gs.registerSlots(['P1-20261017'], 1, 'Gita Sharma', '9000000029');
gs.registerSlots(['P4-20261018'], 1, 'Hari Prasad', '9000000030');
const html = gs.doGet().getContent();

const SHIM = `window.google = { script: { get run() {
  let ok = () => {}, fail = () => {};
  const r = new Proxy({}, { get: (_, k) => k === 'withSuccessHandler' ? (f => (ok = f, r)) : k === 'withFailureHandler' ? (f => (fail = f, r))
    : (...a) => new Promise(res => setTimeout(res, 350)).then(() => window.gsCall(k, a)).then(x => x.err ? fail(new Error(x.err)) : ok(x.ok)) });
  return r; } } };`;

const fontCss = `
@font-face{font-family:'DM Sans';font-weight:400;src:url(https://fonts.gstatic.com/local/dm-sans/files/dm-sans-latin-400-normal.woff2)}
@font-face{font-family:'DM Sans';font-weight:500;src:url(https://fonts.gstatic.com/local/dm-sans/files/dm-sans-latin-500-normal.woff2)}
@font-face{font-family:'DM Sans';font-weight:700;src:url(https://fonts.gstatic.com/local/dm-sans/files/dm-sans-latin-700-normal.woff2)}
@font-face{font-family:'Instrument Serif';font-weight:400;src:url(https://fonts.gstatic.com/local/instrument-serif/files/instrument-serif-latin-400-normal.woff2)}
@font-face{font-family:'Noto Sans Telugu';font-weight:400;src:url(https://fonts.gstatic.com/local/noto-sans-telugu/files/noto-sans-telugu-telugu-400-normal.woff2)}
@font-face{font-family:'Noto Sans Telugu';font-weight:600;src:url(https://fonts.gstatic.com/local/noto-sans-telugu/files/noto-sans-telugu-telugu-600-normal.woff2)}
@font-face{font-family:'Noto Sans Devanagari';font-weight:400;src:url(https://fonts.gstatic.com/local/noto-sans-devanagari/files/noto-sans-devanagari-devanagari-400-normal.woff2)}
@font-face{font-family:'Noto Sans Devanagari';font-weight:600;src:url(https://fonts.gstatic.com/local/noto-sans-devanagari/files/noto-sans-devanagari-devanagari-600-normal.woff2)}`;

// ---- The frame around the page: caption bar, the page, and a live "sheet" panel ----
const wrapper = `<!doctype html><html><head><meta charset="utf-8"><style>${fontCss}
 body{margin:0;background:#0f2438;font-family:'DM Sans','Noto Sans Telugu','Noto Sans Devanagari',sans-serif;overflow:hidden}
 #cap{height:64px;display:flex;align-items:center;gap:14px;padding:0 22px;background:#1A3A5C;color:#fff;border-bottom:3px solid #C9A84C}
 #step{background:#C9A84C;color:#1A3A5C;font-weight:700;border-radius:20px;padding:4px 12px;font-size:15px;white-space:nowrap}
 #text{font-size:21px;font-weight:500}
 #main{display:flex;height:653px}
 #stage{width:560px;display:flex;justify-content:center;align-items:center;background:linear-gradient(180deg,#E1F0FB,#FBFAF6)}
 #phone{width:390px;height:625px;border:10px solid #1b1f24;border-radius:34px;overflow:hidden;box-shadow:0 8px 24px rgba(0,0,0,.35);background:#FBFAF6}
 #app{width:390px;height:100%;border:0;background:#FBFAF6;display:block}
 #sheet{flex:1;background:#fff;border-left:4px solid #C9A84C;overflow:hidden;font-size:12px;color:#222}
 #sheet h3{margin:0;padding:10px 12px;background:#e8f0e8;color:#1e6b3a;font-size:14px;border-bottom:1px solid #cfd8cf}
 #sheet h3 small{display:block;font-weight:400;color:#5b6b5b;font-size:11px}
 #sheet table{border-collapse:collapse;width:100%} #sheet th,#sheet td{border:1px solid #dadce0;padding:4px 6px;vertical-align:top;white-space:pre-line}
 #sheet th{background:#f1f3f4;font-weight:600;font-size:11px} td.flash{background:#fff3b0;transition:background 1.2s}
 #cursor{position:fixed;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:rgba(201,168,76,.55);border:2px solid #C9A84C;
   pointer-events:none;z-index:9;left:640px;top:360px;transition:left .55s ease,top .55s ease}
 #cursor.click{animation:tap .45s} @keyframes tap{0%{transform:scale(1)}50%{transform:scale(1.9);background:rgba(201,168,76,.25)}100%{transform:scale(1)}}
 #card{position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;
   background:linear-gradient(180deg,#E1F0FB,#FBFAF6);color:#1A3A5C;z-index:20;transition:opacity .6s}
 #card h1{font:400 44px 'Instrument Serif','Noto Sans Telugu','Noto Sans Devanagari',serif;margin:0;text-align:center} #card p{font-size:20px;color:#4A6FA5;margin:0;text-align:center}
 #card img{height:90px}
</style></head><body>
<div id="cap"><span id="step">Demo</span><span id="text"></span></div>
<div id="main"><div id="stage"><div id="phone"><iframe id="app" src="http://app.test/"></iframe></div></div><div id="sheet"></div></div>
<div id="cursor"></div><div id="card"></div></body></html>`;


(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: __dirname + '/raw', size: { width: 1280, height: 720 } } });
  await ctx.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: fontCss }));
  await ctx.route('https://fonts.gstatic.com/local/**', r => r.fulfill({ contentType: 'font/woff2',
    body: fs.readFileSync(FS + new URL(r.request().url()).pathname.replace('/local/', '')) }));
  await ctx.route('http://demo.test/', r => r.fulfill({ contentType: 'text/html', body: wrapper }));
  await ctx.route('http://app.test/', r => r.fulfill({ contentType: 'text/html', body: html }));
  await ctx.addInitScript(SHIM);
  const p = await ctx.newPage();
  const DUR = JSON.parse(fs.readFileSync(VO + 'durations.json', 'utf8'));   // each step lasts at least as long as its spoken line
  const t0 = Date.now(), marks = [];
  let stepEnd = 0;
  const say = async name => { const gap = stepEnd - Date.now(); if (gap > 0) await p.waitForTimeout(gap);
    marks.push([name, (Date.now() - t0) / 1000]); stepEnd = Date.now() + DUR[name] * 1000 + 500; };
  await p.exposeFunction('gsCall', (fn, a) => { try { return { ok: JSON.parse(JSON.stringify(gs[fn](...a))) }; } catch (e) { return { err: e.message }; } });
  await p.goto('http://demo.test/');
  const app = p.frameLocator('#app');
  const wait = ms => p.waitForTimeout(ms);

  // Sheet panel: the Slots rows of the sessions in the story; cells that just changed flash yellow.
  let before = null;
  const cols = ['Date', 'Start Time', 'Institution Name', 'Volunteers Needed', 'Status', 'Volunteers'].map(h => SH.indexOf(h));
  const shown = r => /^P(1|4)-/.test(r[0]) && r[1] <= '2026-11-08' || r[0] === 'P2-20261012';
  const drawSheet = async () => {
    const g = slots.grid.slice(1).filter(shown).map(r => r.map(v => v == null ? '' : String(v)));
    const flash = (i, j) => before && before[i] && before[i][j] !== g[i][j];
    const head = cols.map(j => String.fromCharCode(65 + j) + ' · ' + SH[j]);
    const body = g.map((r, i) => '<tr>' + cols.map(j => `<td class="${flash(i, j) ? 'flash' : ''}">${r[j].replace(/</g, '&lt;')}</td>`).join('') + '</tr>').join('');
    await p.evaluate(h => { document.getElementById('sheet').innerHTML = h; setTimeout(() => document.querySelectorAll('td.flash').forEach(td => td.classList.remove('flash')), 1600); },
      `<h3>${T.sheet[0]}<small>${T.sheet[1]}</small></h3><table><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr>${body}</table>`);
    before = g;
  };
  const caption = n => p.evaluate(([s, t]) => { document.getElementById('step').textContent = s; document.getElementById('text').textContent = t; }, [T.step + ' ' + n, T.caps[n - 1]]);
  const card = (show, inner) => p.evaluate(([sh, h]) => { const c = document.getElementById('card'); if (h) c.innerHTML = h; c.style.opacity = sh ? 1 : 0; c.style.pointerEvents = sh ? 'auto' : 'none'; }, [show, inner || '']);
  const moveTo = async loc => { await loc.evaluate(e => e.scrollIntoView({ behavior: 'smooth', block: 'center' })); await wait(700); const b = await loc.boundingBox(); await p.evaluate(([x, y]) => { const c = document.getElementById('cursor'); c.style.left = x + 'px'; c.style.top = y + 'px'; }, [b.x + b.width / 2, b.y + b.height / 2]); await wait(650); };
  const tap = async loc => { await moveTo(loc); await p.evaluate(() => { const c = document.getElementById('cursor'); c.classList.remove('click'); void c.offsetWidth; c.classList.add('click'); }); await loc.click(); await wait(350); };
  const type = async (loc, text) => { await tap(loc); await loc.pressSequentially(text, { delay: 70 }); };
  const settle = async () => { await wait(900); await drawSheet(); };
  const card10 = id => app.locator(`article[data-id="${id}"]`);

  // ---- Title card ----
  const logo = await app.locator('#logo').getAttribute('src').catch(() => '');
  if (LANG !== 'en') await app.locator('#lang').selectOption(LANG);
  await drawSheet();
  await card(true, `<img src="${logo}"><h1>${T.title[0]}</h1><p>${T.title[1]}</p>`);
  await wait(500); await say('intro');
  await wait(3200); await say('s1'); await card(false); await wait(700);
  marks[marks.length - 1][1] += 0.7; stepEnd += 700;

  // ---- 1. Name and mobile ----
  await caption(1); await wait(1200);
  await type(app.locator('#name'), 'Asha Rao');
  // Asha is a saved speaker, so the page fills in her mobile once her name is entered; clear it and type it, as the narration says.
  await tap(app.locator('#mobile')); await app.locator('#mobile').fill(''); await app.locator('#mobile').pressSequentially('9000000027', { delay: 70 });
  await wait(800);
  // ---- 2. One-week calendar ----
  await say('s2'); await caption(2); await wait(900);
  await tap(app.locator('#nextWeek')); await wait(1600);
  await tap(app.locator('#prevWeek')); await wait(1200);
  await tap(app.locator('#calGrid .dbox[data-date="2026-10-17"]')); await wait(1600);
  // ---- 3. Select two sessions, repeat ----
  await say('s3'); await caption(3); await wait(700);
  await tap(card10('P1-20261017').locator('button[data-sel]'));
  await tap(card10('P4-20261018').locator('button[data-sel]'));
  await tap(app.locator('#repeat')); await app.locator('#repeat').selectOption('4'); await wait(1500);
  // ---- 4. Register others ----
  await say('s4'); await caption(4); await wait(700);
  await tap(app.locator('#who'));
  await tap(app.locator('#pickSummary'));
  await tap(app.locator('#pickList label', { hasText: 'Ravi Kumar' }).locator('input[type=checkbox]'));
  await wait(700); await tap(app.locator('#whoDone')); await wait(900);
  // ---- 5. Register, check, Confirm; My registrations ----
  await say('s5'); await caption(5); await wait(600);
  await tap(app.locator('#register'));
  await app.locator('#confirm:not([hidden])').waitFor(); await wait(2600);
  await tap(app.locator('#confirmGo')); await settle();
  await moveTo(app.locator('#mineBox')); await wait(2400);
  // ---- 6. Release one date; release closed under 12 hours ----
  await say('s6'); await caption(6); await wait(600);
  await tap(card10('P1-20261024').locator('button[data-release]')); await settle(); await wait(1200);
  await moveTo(card10('P2-20261012').locator('.act')); await wait(2600);
  // ---- 7. A cancelled date ----
  await say('s7'); await caption(7); await wait(600);
  slots.grid.find(r => r[0] === 'P1-20261031')[SH.indexOf('Status')] = 'Cancelled'; gs.onEdit({});
  await drawSheet();
  await app.locator('body').evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await app.locator('#alerts .alert').waitFor(); await moveTo(app.locator('#alerts')); await wait(2800);
  // ---- 8. Language ----
  await say('s8'); await caption(8); await wait(800);
  for (const [i, l] of T.langs.entries()) { await tap(app.locator('#lang')); await app.locator('#lang').selectOption(l); await wait(i < 2 ? 2400 : 1200); }

  // ---- End card ----
  await say('end');
  await card(true, `<img src="${logo}"><h1>${T.end[0]}</h1><p>${T.end[1]}</p>`);
  await wait(Math.max(3200, stepEnd - Date.now()));
  fs.writeFileSync(VO + 'marks.json', JSON.stringify(marks));
  const vid = p.video();
  await ctx.close(); await browser.close();
  fs.renameSync(await vid.path(), OUT);
  console.log('recorded', fs.statSync(OUT).size, 'bytes');
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
