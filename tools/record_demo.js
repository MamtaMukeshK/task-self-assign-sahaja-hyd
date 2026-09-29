// Re-records docs/demo.mp4. Run from tools/: npm i (see FS line), node record_demo.js. Needs Chromium at /opt/pw-browsers/chromium.
// Records a short end-user demo: the real Index.html + Code.gs logic on a demo copy of the 30-Sep layout.
const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const REPO = path.resolve(__dirname, '..');
const { load, makeSheet } = require(REPO + '/test/harness.js');
const html = fs.readFileSync(REPO + '/Index.html', 'utf8');
const FS = __dirname + '/node_modules/@fontsource/';  // npm i playwright-core @fontsource/dm-sans @fontsource/instrument-serif @fontsource/noto-sans-telugu @fontsource/noto-sans-devanagari

// ---- Demo data: real 30-Sep schools/times/map links; made-up volunteers and numbers ----
const H = ['Sl.No', 'Sahaja Yoga ( IND)\n Speaker Name', 'Total volunteers needed', 'count of Volunteers still neeeded',
  'Institution name', 'Date', 'Time', 'Google map'];
const day30 = makeSheet('30-Sep', 1, [H,
  ['1', 'Anita Sharma 9000000101', '20', '19', 'Sri Chaitanya DR BS Rao', '30-Sep-26', ' 2pm to 3pm. (STRICT TIMINGS) ', 'https://maps.app.goo.gl/dnAqPMzUPHFdHdCu6'],
  ['2', 'Suresh Reddy 9000000102\nLakshmi Devi 9000000103', '6', '4', 'Sri Chaitanya College', '30-Sep-26', '3:30 to 4:30 pm - 6 sessions', 'https://maps.google.com/maps?q=17.4652273%2C78.3084288&z=17'],
  ['3', '', '12', '12', 'Sri Chaitanya College Bharati Bhavan', '30-Sep-26', '11:00 AM to 12:00 PM', 'https://maps.app.goo.gl/25VDmkCw6exXCtVU7'],
]);
const day01 = makeSheet('01-Oct', 2, [H, ['1', '', '4', '4', 'Demo School', '01-Oct-26', '10:00 AM to 11:00 AM', '']]);
const speakers = makeSheet('Speaker', 3, [['Sr. No.', 'Speaker', 'Mobile', 'Language'],
  ['1', 'Anita Sharma', '9000000101', 'English, Hindi'], ['2', 'Arjun Varma', '9000000104', 'Telugu'],
  ['3', 'Kiran Rao', '9000000105', 'Telugu, English'], ['4', 'Lakshmi Devi', '9000000103', 'Telugu'],
  ['5', 'Meera Das', '9000000106', 'Hindi'], ['6', 'Ravi Kumar', '9000000107', 'Telugu, Hindi'],
  ['7', 'Suresh Reddy', '9000000102', 'Telugu']]);
const gs = load([day30, day01, speakers], new Date(Date.UTC(2026, 8, 30, 10, 0)));   // 30 Sep, 10:00 India time

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
 body{margin:0;background:#0f2438;font-family:'DM Sans',sans-serif;overflow:hidden}
 #cap{height:64px;display:flex;align-items:center;gap:14px;padding:0 22px;background:#1A3A5C;color:#fff;border-bottom:3px solid #C9A84C}
 #step{background:#C9A84C;color:#1A3A5C;font-weight:700;border-radius:20px;padding:4px 12px;font-size:15px;white-space:nowrap}
 #text{font-size:21px;font-weight:500}
 #main{display:flex;height:653px}
 #app{width:830px;height:100%;border:0;background:#FBFAF6}
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
 #card h1{font:400 44px 'Instrument Serif',serif;margin:0;text-align:center} #card p{font-size:20px;color:#4A6FA5;margin:0;text-align:center}
 #card img{height:90px}
</style></head><body>
<div id="cap"><span id="step">Demo</span><span id="text"></span></div>
<div id="main"><iframe id="app" src="http://app.test/"></iframe><div id="sheet"></div></div>
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
  await p.exposeFunction('gsCall', (fn, a) => { try { return { ok: JSON.parse(JSON.stringify(gs[fn](...a))) }; } catch (e) { return { err: e.message }; } });
  await p.goto('http://demo.test/');
  const app = p.frameLocator('#app');
  const wait = ms => p.waitForTimeout(ms);

  // Sheet panel: shows the 30-Sep tab as stored; cells that just changed flash yellow.
  let before = null;
  const drawSheet = async () => {
    const g = day30.grid.map(r => r.map(v => v == null ? '' : String(v)));
    const cols = [0, 1, 2, 3, 4, 6];
    const flash = (i, j) => before && before[i] && before[i][j] !== g[i][j];
    const head = ['A · Sl.No', 'B · Speaker Name', 'C · Total needed', 'D · Still needed', 'E · Institution', 'G · Time'];
    const body = g.slice(1).map((r, i) => '<tr>' + cols.map(j => `<td class="${flash(i + 1, j) ? 'flash' : ''}">${r[j].replace(/</g, '&lt;')}</td>`).join('') + '</tr>').join('');
    await p.evaluate(h => { document.getElementById('sheet').innerHTML = h; setTimeout(() => document.querySelectorAll('td.flash').forEach(td => td.classList.remove('flash')), 1600); },
      `<h3>Google Sheet · 30-Sep tab<small>Demo copy: made-up names and numbers</small></h3><table><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr>${body}</table>`);
    before = g;
  };
  const caption = (step, text) => p.evaluate(([s, t]) => { document.getElementById('step').textContent = s; document.getElementById('text').textContent = t; }, [step, text]);
  const card = (show, inner) => p.evaluate(([sh, h]) => { const c = document.getElementById('card'); if (h) c.innerHTML = h; c.style.opacity = sh ? 1 : 0; c.style.pointerEvents = sh ? 'auto' : 'none'; }, [show, inner || '']);
  const moveTo = async loc => { const b = await loc.boundingBox(); await p.evaluate(([x, y]) => { const c = document.getElementById('cursor'); c.style.left = x + 'px'; c.style.top = y + 'px'; }, [b.x + b.width / 2, b.y + b.height / 2]); await wait(650); };
  const tap = async loc => { await moveTo(loc); await p.evaluate(() => { const c = document.getElementById('cursor'); c.classList.remove('click'); void c.offsetWidth; c.classList.add('click'); }); await loc.click(); await wait(350); };
  const type = async (loc, text) => { await tap(loc); await loc.pressSequentially(text, { delay: 70 }); };
  const settle = async () => { await wait(900); await drawSheet(); };

  // ---- Title card ----
  const logo = await app.locator('#logo').getAttribute('src').catch(() => '');
  await drawSheet();
  await card(true, `<img src="${logo}"><h1>Hyderabad 2026 · Self Realization Tour</h1><p>How to pick your school in under a minute</p>`);
  await wait(3200); await card(false); await wait(700);

  // ---- 1. Claim ----
  await caption('Step 1', 'Open the link: today\'s schools are listed. Type your name and mobile once.');
  await wait(1500);
  await type(app.locator('#name'), 'Priya Nair');
  await type(app.locator('#mobile'), '9000000108');
  await wait(600);
  await caption('Step 2', 'Tap Claim next to a school. Your row turns green and the sheet updates.');
  await wait(1200);
  await tap(app.locator('#grid tr').nth(3).locator('button:text-is("Claim")'));
  await settle(); await wait(2600);

  // ---- 2. Release ----
  await caption('Step 3', 'Changed your mind? Tap Release. Your line is removed from the sheet.');
  await wait(1000);
  await tap(app.locator('#grid tr').nth(3).locator('button:text-is("Release")'));
  await settle(); await wait(2200);

  // ---- 3. Register others from the list ----
  await caption('Step 4', 'Registering a group? Tick "Register others" and choose speakers from the list.');
  await wait(1000);
  await tap(app.locator('#showOthers'));
  await tap(app.locator('#picker summary'));
  await type(app.locator('#pickSearch'), 'r');
  await wait(500);
  await tap(app.locator('#pickList label', { hasText: 'Ravi Kumar' }).locator('input'));
  await tap(app.locator('#pickList label', { hasText: 'Arjun Varma' }).locator('input'));
  await wait(800);
  await caption('Step 5', 'Tap Claim: you and everyone ticked are added together, marked "via" you.');
  await tap(app.locator('#picker summary'));
  await wait(400);
  await tap(app.locator('#grid tr').nth(3).locator('button:text-is("Claim")'));
  await settle(); await wait(3000);

  // ---- 4. Language ----
  await caption('Step 6', 'Prefer Telugu or Hindi? Choose a language at the top.');
  await wait(900);
  await tap(app.locator('#lang')); await app.locator('#lang').selectOption('te'); await wait(2600);
  await tap(app.locator('#lang')); await app.locator('#lang').selectOption('hi'); await wait(2600);
  await tap(app.locator('#lang')); await app.locator('#lang').selectOption('en'); await wait(1200);

  // ---- End card ----
  await card(true, `<img src="${logo}"><h1>Open the link · pick a date · tap Claim</h1><p>Your name goes straight into the sheet for the organisers</p>`);
  await wait(3200);
  const vid = p.video();
  await ctx.close(); await browser.close();
  fs.renameSync(await vid.path(), __dirname + '/demo.webm');  // then: ffmpeg -i tools/demo.webm -c:v libx264 -pix_fmt yuv420p -movflags +faststart docs/demo.mp4
  console.log('recorded', fs.statSync(__dirname + '/demo.webm').size, 'bytes');
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
