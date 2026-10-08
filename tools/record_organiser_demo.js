// Records the organiser demo (stage 4c): how to run the Follow-up sheet's Program plan and Slots tabs, on a laptop-sized
// screen built from the real tab layout (not live Google Sheets: Google's sites can't be opened from the build machine).
// The real followup/Code.gs runs underneath (generator, Update report, WhatsApp list, "mark as sent").
// Usage (from tools/): node record_organiser_demo.js; then cd voiceover && python3 mix.py <ffmpeg> en organiser
const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const REPO = path.resolve(__dirname, '..');
const { load, makeSheet } = require(REPO + '/test/harness.js');
const FS = __dirname + '/node_modules/@fontsource/';
const fontCss = `
@font-face{font-family:'DM Sans';font-weight:400;src:url(https://fonts.gstatic.com/local/dm-sans/files/dm-sans-latin-400-normal.woff2)}
@font-face{font-family:'DM Sans';font-weight:500;src:url(https://fonts.gstatic.com/local/dm-sans/files/dm-sans-latin-500-normal.woff2)}
@font-face{font-family:'DM Sans';font-weight:700;src:url(https://fonts.gstatic.com/local/dm-sans/files/dm-sans-latin-700-normal.woff2)}
@font-face{font-family:'Instrument Serif';font-weight:400;src:url(https://fonts.gstatic.com/local/instrument-serif/files/instrument-serif-latin-400-normal.woff2)}
@font-face{font-family:'Noto Sans Telugu';font-weight:400;src:url(https://fonts.gstatic.com/local/noto-sans-telugu/files/noto-sans-telugu-telugu-400-normal.woff2)}
@font-face{font-family:'Noto Sans Telugu';font-weight:600;src:url(https://fonts.gstatic.com/local/noto-sans-telugu/files/noto-sans-telugu-telugu-600-normal.woff2)}
@font-face{font-family:'Noto Sans Devanagari';font-weight:400;src:url(https://fonts.gstatic.com/local/noto-sans-devanagari/files/noto-sans-devanagari-devanagari-400-normal.woff2)}
@font-face{font-family:'Noto Sans Devanagari';font-weight:600;src:url(https://fonts.gstatic.com/local/noto-sans-devanagari/files/noto-sans-devanagari-devanagari-600-normal.woff2)}`;

const VO = __dirname + '/voiceover/organiser/', OUT = __dirname + '/organiser-demo.webm';

// ---- Demo data: the user's sample sheet (phone numbers replaced); line P7 entered as One-off (user, 2026-10-08) ----
const DATA = {"Program plan": [["Line ID", "Day of the Week", "Start Time", "End Time", "Frequency", "Week of month", "Day of month", "Institution Name", "Address", "Google map", "Volunteers Needed", "From", "Until", "Principal Contact", "Sahaji Contact", "Notes"], ["P1", "Saturday", "6:30 PM", "7:30 PM", "Weekly", "", "", "Ameerpet Centre", "Road 3, Ameerpet", "https://maps.google.com/?q=Ameerpet%2C%20Hyderabad", "4", "2026-10-01", "2026-12-31", "Pradeep Reddy 9000000021", "Padma 9000000022", ""], ["P2", "Every Day", "7:00 AM", "7:45 AM", "Daily", "", "", "Kukatpally Centre", "KPHB Colony", "https://maps.google.com/?q=KPHB%20Colony%2C%20Hyderabad", "2", "2026-10-12", "2026-10-25", "Kasipati 9000000023", "Shanti 9000000024", ""], ["P3", "", "6:30 PM", "7:30 PM", "Daily, weekdays only (Mon-Fri)", "", "", "Dilsukhnagar Centre", "Near the bus stand", "https://maps.google.com/?q=Dilsukhnagar%2C%20Hyderabad", "2", "2026-10-12", "2026-11-30", "Lakshmi 9000000025", "Padma 9000000022", ""], ["P4", "Sunday", "10:00 AM", "11:00 AM", "Every 2 weeks", "", "", "Secunderabad Centre", "SP Road", "https://maps.google.com/?q=Secunderabad%2C%20Hyderabad", "3", "2026-10-04", "", "Suresh 9000000026", "Padma 9000000022", "No Until date: keeps 12 weeks ahead"], ["P5", "Saturday", "4:00 PM", "5:30 PM", "Monthly, same weekday", "2nd", "", "Gachibowli Centre", "", "https://maps.google.com/?q=Gachibowli%2C%20Hyderabad", "5", "2026-10-01", "2027-03-31", "Lakshmi 9000000025", "Padma 9000000022", ""], ["P6", "", "5:00 PM", "6:00 PM", "Monthly, same date", "", "15", "Madhapur Centre", "", "https://maps.google.com/?q=Madhapur%2C%20Hyderabad", "2", "2026-10-01", "2027-03-31", "Suresh 9000000026", "Padma 9000000022", ""], ["P7", "", "11:00 AM", "12:30 PM", "Custom", "", "", "Begumpet Centre", "", "https://maps.google.com/?q=Begumpet%2C%20Hyderabad", "6", "2026-11-14", "", "Lakshmi 9000000025", "Padma 9000000022", "Children's Day programme"]], "Speakers": [["Sr. No.", "Speaker", "Mobile"], ["1", "Asha Rao", "9000000027"], ["2", "Ravi Kumar", "9000000028"], ["3", "Meena Iyer", ""], ["4", "Gita Sharma", "9000000029"], ["5", "Hari Prasad", "9000000030"]]};
const planRows = DATA['Program plan'].map((r, i) => i ? [''].concat(r.slice(1)) : r);
planRows.forEach(r => { if (r[4] === 'Custom') r[4] = 'One-off'; });
const PH = planRows[0];
const SH = ['Slot ID', 'Date', 'Day', 'Start Time', 'End Time', 'Institution Name', 'Address', 'Map', 'Principal Contact', 'Sahaji Contact',
  'Volunteers Needed', 'Status', 'Volunteers', 'Still needed', 'Cancellation notice sent', 'Notes'];
const plan = makeSheet('Program plan', 1, planRows), slots = makeSheet('Slots', 2, [SH]);
const gs = load([plan, slots, makeSheet('Speakers', 3, DATA.Speakers)], new Date(Date.UTC(2026, 9, 12, 10, 0)), 'followup/Code.gs'); // Mon 12 Oct 2026, 10 AM
gs.generateSlots();
gs.registerSlots(['P1-20261017'], 1, 'Asha Rao', '9000000027', 'Ravi Kumar 9000000028');
gs.registerSlots(['P1-20261024'], 1, 'Gita Sharma', '9000000029');
const ss = gs.SpreadsheetApp.getActiveSpreadsheet();

// ---- How cells look in the sheet (dates and times as the sheet's formats show them) ----
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const show = (title, v) => {
  const s = v == null ? '' : String(v);
  if (/^\d{4}-\d\d-\d\d$/.test(s)) { const d = new Date(s + 'T12:00:00Z');
    return (title === 'Date' ? DAYS[d.getUTCDay()] + ' ' : '') + d.getUTCDate() + ' ' + MON[d.getUTCMonth()] + ' ' + d.getUTCFullYear(); }
  if (/^\d\d:\d\d$/.test(s)) { const h = +s.slice(0, 2); return (h % 12 || 12) + ':' + s.slice(3) + (h < 12 ? ' AM' : ' PM'); }
  return s;
};
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const VIEW = {   // columns shown (the rest are scrolled off to the right, as on a laptop screen)
  'Program plan': ['Line ID', 'Day of the Week', 'Start Time', 'End Time', 'Frequency', 'Week of month', 'Day of month', 'Institution Name',
    'Volunteers Needed', 'From', 'Until', 'Principal Contact', 'Sahaji Contact'],
  'Slots': ['Slot ID', 'Date', 'Start Time', 'Institution Name', 'Principal Contact', 'Sahaji Contact', 'Volunteers Needed',
    'Status', 'Volunteers', 'Still needed', 'Cancellation notice sent'],
  'Update report': null };
const KIND = { 'Status': 'edit', 'Volunteers Needed': 'edit', 'Principal Contact': 'edit', 'Sahaji Contact': 'edit', 'Notes': 'edit',
  'Volunteers': 'page', 'Still needed': 'page', 'Cancellation notice sent': 'page' };
// HTML for one tab: real column letters and row numbers; o.rows = which data rows (sheet row numbers); o.flash = set of 'row|title'.
const tabHtml = (name, o = {}) => {
  const grid = ss.getSheetByName(name).grid, head = grid[0];
  const cols = (VIEW[name] || head.map((h, i) => i ? null : h).filter(h => h !== null)).map(t => [t, head.indexOf(t)]).filter(c => c[1] >= 0);
  const rows = o.rows || grid.map((_, i) => i + 1).slice(1, 21);
  const L = i => String.fromCharCode(65 + i);
  let h = '<tr><th class="rn"></th>' + cols.map(([t, i]) => `<th class="cl">${L(i)}</th>`).join('') + '</tr>';
  h += '<tr><th class="rn">1</th>' + cols.map(([t]) => `<td class="hd ${o.kinds ? KIND[t] || 'script' : ''}">${esc(t)}</td>`).join('') + '</tr>';
  rows.forEach(r => { const row = grid[r - 1] || [];
    h += `<tr data-r="${r}"><th class="rn">${r}</th>` + cols.map(([t, i]) => `<td data-c="${esc(t)}" class="${o.kinds ? KIND[t] || 'script' : ''}${o.flash && o.flash.has(r + '|' + t) ? ' flash' : ''}">${esc(show(t, row[i])).replace(/\n/g, '<br>')}</td>`).join('') + '</tr>'; });
  return h;
};
const rowsWhere = (name, test) => ss.getSheetByName(name).grid.map((r, i) => [r, i + 1]).filter(([r, i]) => i > 1 && test(r)).map(([, i]) => i);

const app = `<div id="cap"><span id="step">Guide</span><span id="text"></span></div>
<div id="win"><div id="doc">Follow-up Program 2026</div>
<div id="menus"><span>File</span><span>Edit</span><span>View</span><span>Insert</span><span>Format</span><span>Data</span><span>Tools</span><span>Extensions</span><span>Help</span><span id="m-program">Program</span></div>
<div id="fbar"><span id="ref">A1</span><span id="fx"></span></div>
<div id="note"></div><div id="wrap"><table id="grid"></table></div>
<div id="tabs"><span data-tab="Program plan">Program plan</span><span data-tab="Slots">Slots</span><span data-tab="Speakers">Speakers</span><span data-tab="Update report">Update report</span></div>
<div id="menu" hidden><div data-m="update">Update slots now</div><div data-m="wa">Cancellation WhatsApp list</div><div data-m="sent">Mark cancellation notices as sent</div><hr><div>Set up the sheet (first time)</div></div>
<div id="drop" hidden></div>
<div id="modal" hidden><div id="box"><h4 id="boxt"></h4><div id="boxb"></div><div id="boxk"></div></div></div></div>
<div id="cursor"></div><div id="card"></div>`;
const css = `
 body{margin:0;background:#0f2438;font-family:'DM Sans',sans-serif;overflow:hidden}
 #cap{height:64px;display:flex;align-items:center;gap:14px;padding:0 22px;background:#1A3A5C;color:#fff;border-bottom:3px solid #C9A84C}
 #step{background:#C9A84C;color:#1A3A5C;font-weight:700;border-radius:20px;padding:4px 12px;font-size:15px;white-space:nowrap}
 #text{font-size:20px;font-weight:500}
 #win{position:relative;height:653px;background:#fff;display:flex;flex-direction:column;font-size:12px;color:#202124}
 #doc{padding:6px 14px 0;font-size:17px} #menus{display:flex;gap:16px;padding:4px 14px 6px;font-size:13.5px;color:#3c4043}
 #m-program{font-weight:700;color:#1A3A5C} #fbar{display:flex;border-top:1px solid #dadce0;border-bottom:1px solid #dadce0;font-size:13px}
 #ref{width:70px;padding:4px 8px;border-right:1px solid #dadce0;color:#5f6368} #fx{padding:4px 10px;flex:1;white-space:nowrap;overflow:hidden}
 #note{display:flex;gap:8px;padding:0 10px;min-height:0} #note span{margin:5px 0;padding:3px 10px;border-radius:12px;font-weight:700;font-size:12.5px}
 .k-edit{background:#d7f0dc;color:#1e6b3a} .k-page{background:#dbe8fb;color:#1a4e9a} .k-script{background:#eceff1;color:#5f6368} .k-warn{background:#fde7e5;color:#b3261e}
 #wrap{flex:1;overflow:hidden} table{border-collapse:collapse} th,td{border:1px solid #e2e3e5;padding:3px 6px;white-space:nowrap;vertical-align:top;height:18px}
 th.cl,th.rn{background:#f8f9fa;color:#5f6368;font-weight:500;text-align:center} th.rn{width:28px}
 td.hd{font-weight:700;background:#f1f3f4;white-space:normal;max-width:84px}   /* titles wrap so every column fits on screen */ td.edit{background:#eef9f0} td.page{background:#eef3fc} td.hd.edit{background:#d7f0dc} td.hd.page{background:#dbe8fb}
 td.flash{background:#fff3b0 !important;transition:background 1.4s} td.sel{outline:2px solid #1a73e8;outline-offset:-2px}
 #tabs{display:flex;gap:2px;background:#f1f3f4;border-top:1px solid #dadce0;padding:0 10px} #tabs span{padding:6px 16px;color:#3c4043}
 #tabs span.on{background:#fff;color:#1a73e8;font-weight:700;border-bottom:3px solid #1a73e8}
 #menu{position:absolute;left:600px;top:58px;background:#fff;box-shadow:0 2px 10px rgba(0,0,0,.25);border-radius:4px;padding:6px 0;font-size:13.5px;z-index:5}
 #menu div{padding:7px 22px} #menu hr{border:0;border-top:1px solid #e2e3e5;margin:4px 0}
 #drop{position:absolute;background:#fff;box-shadow:0 2px 10px rgba(0,0,0,.25);border-radius:4px;padding:4px 0;z-index:5;font-size:13px} #drop div{padding:6px 16px}
 #modal{position:absolute;inset:0;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;z-index:6}
 #modal[hidden],#menu[hidden],#drop[hidden]{display:none}
 #box{background:#fff;border-radius:8px;padding:16px 20px;max-width:640px;box-shadow:0 4px 18px rgba(0,0,0,.3);font-size:14px}
 #box h4{margin:0 0 10px;font-size:16px} #boxb{white-space:pre-line} #boxb iframe{width:600px;height:380px;border:0}
 #boxk{display:flex;gap:10px;justify-content:flex-end;margin-top:14px} #boxk button{font:inherit;padding:6px 18px;border-radius:4px;border:1px solid #1a73e8;background:#1a73e8;color:#fff}
 #cursor{position:fixed;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:rgba(201,168,76,.55);border:2px solid #C9A84C;
   pointer-events:none;z-index:9;left:640px;top:360px;transition:left .55s ease,top .55s ease}
 #cursor.click{animation:tap .45s} @keyframes tap{0%{transform:scale(1)}50%{transform:scale(1.9);background:rgba(201,168,76,.25)}100%{transform:scale(1)}}
 #card{position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;
   background:linear-gradient(180deg,#E1F0FB,#FBFAF6);color:#1A3A5C;z-index:20;transition:opacity .6s}
 #card h1{font:400 44px 'Instrument Serif',serif;margin:0;text-align:center} #card p{font-size:20px;color:#4A6FA5;margin:0;text-align:center} #card img{height:90px}`;

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: __dirname + '/raw', size: { width: 1280, height: 720 } } });
  await ctx.route('https://fonts.gstatic.com/local/**', r => r.fulfill({ contentType: 'font/woff2',
    body: fs.readFileSync(FS + new URL(r.request().url()).pathname.replace('/local/', '')) }));
  await ctx.route('http://demo.test/', r => r.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>${fontCss}${css}</style></head><body>${app}</body></html>` }));
  const p = await ctx.newPage();
  const DUR = JSON.parse(fs.readFileSync(VO + 'durations.json', 'utf8'));
  const t0 = Date.now(), marks = [];
  let stepEnd = 0;
  const say = async name => { const gap = stepEnd - Date.now(); if (gap > 0) await p.waitForTimeout(gap);
    marks.push([name, (Date.now() - t0) / 1000]); stepEnd = Date.now() + DUR[name] * 1000 + 500; };
  await p.goto('http://demo.test/');
  const wait = ms => p.waitForTimeout(ms);
  const T = { step: 'Step', caps: [
    'Program plan: one line per regular session (two days a week = two lines). Leave Line ID empty.',
    'Frequency: daily, weekdays only, weekly, every 2 weeks, monthly (a weekday or a date), or one-off.',
    'Program → Update slots now: one row per date in Slots. It also runs every Sunday night.',
    'Slots: you may change Status, Volunteers Needed, the contacts and Notes. Never delete a row.',
    'Changed a plan line? Update slots now again: dates with volunteers are kept and listed.',
    'To cancel one date, set its Status to Cancelled. Volunteers see a red notice.',
    'Program → Cancellation WhatsApp list, send each one, then Mark cancellation notices as sent.',
    'Who is coming: the Volunteers column of each date.'] };
  const caption = n => p.evaluate(([s, t]) => { document.getElementById('step').textContent = s; document.getElementById('text').textContent = t; }, [T.step + ' ' + n, T.caps[n - 1]]);
  const card = (show, inner) => p.evaluate(([sh, h]) => { const c = document.getElementById('card'); if (h) c.innerHTML = h; c.style.opacity = sh ? 1 : 0; c.style.pointerEvents = sh ? 'auto' : 'none'; }, [show, inner || '']);
  const moveTo = async loc => { await loc.evaluate(e => e.scrollIntoView({ behavior: 'smooth', block: 'center' })); await wait(700); const b = await loc.boundingBox(); await p.evaluate(([x, y]) => { const c = document.getElementById('cursor'); c.style.left = x + 'px'; c.style.top = y + 'px'; }, [b.x + b.width / 2, b.y + b.height / 2]); await wait(650); };
  const tap = async loc => { await moveTo(loc); await p.evaluate(() => { const c = document.getElementById('cursor'); c.classList.remove('click'); void c.offsetWidth; c.classList.add('click'); }); await loc.click(); await wait(350); };
  const draw = async (name, o) => { await p.evaluate(([h, n, label]) => { document.getElementById('grid').innerHTML = h;
      document.querySelectorAll('#tabs span').forEach(s => s.classList.toggle('on', s.dataset.tab === n));
      document.getElementById('note').innerHTML = label || ''; setTimeout(() => document.querySelectorAll('td.flash').forEach(td => td.classList.remove('flash')), 1800); },
    [tabHtml(name, o), name, (o && o.label) || '']); };
  const cell = (r, title) => p.locator(`#grid tr[data-r="${r}"] td[data-c="${title}"]`);
  const select = async (r, title) => { await tap(cell(r, title)); await p.evaluate(([r, t]) => { document.querySelectorAll('td.sel').forEach(e => e.classList.remove('sel'));
      const c = document.querySelector(`#grid tr[data-r="${r}"] td[data-c="${t}"]`); c.classList.add('sel');
      const col = [...c.parentNode.children].indexOf(c); document.getElementById('ref').textContent = document.querySelector('#grid tr').children[col].textContent + r;
      document.getElementById('fx').textContent = c.textContent; }, [r, title]); };
  const typeIn = async (r, title, text) => { await select(r, title);
    for (let i = 1; i <= text.length; i++) { await p.evaluate(([r, t, s]) => { const c = document.querySelector(`#grid tr[data-r="${r}"] td[data-c="${t}"]`);
      c.textContent = s; document.getElementById('fx').textContent = s; }, [r, title, text.slice(0, i)]); await wait(45); } };
  const runMenu = async (item, fn) => { await tap(p.locator('#m-program')); await p.evaluate(() => { document.getElementById('menu').hidden = false; }); await wait(700);
    await tap(p.locator(`#menu div[data-m="${item}"]`)); await p.evaluate(() => { document.getElementById('menu').hidden = true; }); return fn(); };
  const modal = async (title, body, buttons, choose) => { await p.evaluate(([t, b, k]) => { document.getElementById('boxt').textContent = t;
      document.getElementById('boxb').innerHTML = b; document.getElementById('boxk').innerHTML = k.map(x => `<button>${x}</button>`).join('');
      document.getElementById('modal').hidden = false; }, [title, body, buttons]); await wait(2200);
    await tap(p.locator('#boxk button', { hasText: choose })); await p.evaluate(() => { document.getElementById('modal').hidden = true; }); };
  const dropdown = async (r, title, options, choose) => { const b = await cell(r, title).boundingBox();
    await p.evaluate(([o, x, y]) => { const d = document.getElementById('drop'); d.innerHTML = o.map(v => `<div>${v}</div>`).join('');
      d.style.left = x + 'px'; d.style.top = (y - 64) + 'px'; d.hidden = false; }, [options, b.x, b.y + b.height]); await wait(1800);
    await tap(p.locator('#drop div', { hasText: choose }).first()); await p.evaluate(() => { document.getElementById('drop').hidden = true; }); };
  const lastAlert = () => gs._alerts[gs._alerts.length - 1];

  // ---- Title card; first caption says this is a copy of the layout ----
  await card(true, `<h1>Follow-up Program · Organisers</h1><p>How to run the Program plan and Slots tabs</p>`);
  await draw('Program plan');
  await wait(500); await say('o-intro');
  await wait(2600); await card(false);
  await p.evaluate(() => { document.getElementById('text').textContent = 'Organisers\' guide · This screen is a copy of the sheet\'s layout, not live Google Sheets.'; });
  await wait(1800);

  // ---- 1. A new plan line (row 9) ----
  const r = plan.grid.length + 1;
  await say('o1'); await caption(1);
  await draw('Program plan', { rows: plan.grid.map((_, i) => i + 1).slice(1).concat([r]) });
  const line = { 'Day of the Week': 'Thursday', 'Start Time': '5:00 PM', 'End Time': '6:00 PM', 'Institution Name': 'ZP High School', 'Volunteers Needed': '3',
    'From': '15 Oct 2026', 'Until': '31 Dec 2026', 'Principal Contact': 'Principal H 9000000031', 'Sahaji Contact': 'Padma 9000000022' };
  for (const [t, v] of Object.entries(line)) await typeIn(r, t, v);
  // ---- 2. Frequency from the list ----
  await say('o2'); await caption(2);
  await select(r, 'Frequency');
  await dropdown(r, 'Frequency', gs.FREQUENCIES, 'Weekly');
  await p.evaluate(rr => { document.querySelector(`#grid tr[data-r="${rr}"] td[data-c="Frequency"]`).textContent = 'Weekly'; }, r);
  plan.grid.push(PH.map(h => ({ 'Day of the Week': 'Thursday', 'Start Time': '5:00 PM', 'End Time': '6:00 PM', 'Frequency': 'Weekly', 'Institution Name': 'ZP High School',
    'Volunteers Needed': '3', 'From': '2026-10-15', 'Until': '2026-12-31', 'Principal Contact': 'Principal H 9000000031', 'Sahaji Contact': 'Padma 9000000022' })[h] || ''));
  await wait(1200);
  // ---- 3. Update slots now ----
  await say('o3'); await caption(3);
  await runMenu('update', () => gs.menuUpdateSlots());
  await modal('Program', lastAlert(), ['OK'], 'OK');
  await draw('Program plan', { rows: plan.grid.map((_, i) => i + 1).slice(1), flash: new Set([r + '|Line ID']) }); await wait(1200);
  await tap(p.locator('#tabs span[data-tab="Slots"]'));
  const p8 = rowsWhere('Slots', x => /^P8-/.test(x[0]));
  await draw('Slots', { rows: rowsWhere('Slots', x => x[1] <= '2026-10-17'), flash: new Set(p8.map(i => i + '|Slot ID').concat(p8.map(i => i + '|Date'))) });
  await wait(1500);
  // ---- 4. Who writes which Slots columns ----
  await say('o4'); await caption(4);
  await draw('Slots', { rows: rowsWhere('Slots', x => x[1] <= '2026-10-17'), kinds: true,
    label: '<span class="k-edit">You may change</span><span class="k-page">Written by the page</span><span class="k-script">Written by the script</span>' });
  await wait(3800);
  await draw('Slots', { rows: rowsWhere('Slots', x => x[1] <= '2026-10-17'), kinds: true,
    label: '<span class="k-edit">You may change</span><span class="k-page">Written by the page</span><span class="k-script">Written by the script</span><span class="k-warn">Never delete a row: set Status to Cancelled</span>' });
  await wait(2500);
  // ---- 5. Change a plan line: empty dates follow, booked ones are kept ----
  await say('o5'); await caption(5);
  await tap(p.locator('#tabs span[data-tab="Program plan"]')); await draw('Program plan', { rows: plan.grid.map((_, i) => i + 1).slice(1) });
  await typeIn(2, 'Start Time', '7:00 PM'); plan.grid[1][PH.indexOf('Start Time')] = '7:00 PM';
  await runMenu('update', () => gs.menuUpdateSlots());
  await modal('Program', lastAlert(), ['OK'], 'OK');
  await tap(p.locator('#tabs span[data-tab="Slots"]'));
  const p1 = rowsWhere('Slots', x => /^P1-/.test(x[0]) && x[1] <= '2026-11-14');
  await draw('Slots', { rows: p1, flash: new Set(p1.filter(i => slots.grid[i - 1][3] === '19:00').map(i => i + '|Start Time')), label: '<span class="k-script">Filter: Slot ID starts with P1</span>' });
  await wait(2600);
  await tap(p.locator('#tabs span[data-tab="Update report"]')); await draw('Update report'); await wait(2600);
  // ---- 6. Cancel one date ----
  await say('o6'); await caption(6);
  await tap(p.locator('#tabs span[data-tab="Slots"]')); await draw('Slots', { rows: p1, label: '<span class="k-script">Filter: Slot ID starts with P1</span>' });
  const r24 = rowsWhere('Slots', x => x[0] === 'P1-20261024')[0];
  await select(r24, 'Status'); await dropdown(r24, 'Status', ['Open', 'Cancelled'], 'Cancelled');
  slots.grid[r24 - 1][SH.indexOf('Status')] = 'Cancelled'; gs.onEdit({});
  await draw('Slots', { rows: p1, flash: new Set([r24 + '|Status']), label: '<span class="k-script">Filter: Slot ID starts with P1</span>' }); await wait(1500);
  // ---- 7. WhatsApp list, then mark as sent ----
  await say('o7'); await caption(7);
  await runMenu('wa', () => gs.menuCancellationList());
  const dlg = gs._dialogs[gs._dialogs.length - 1].html;
  await modal('Cancellation WhatsApp list', `<iframe srcdoc="${dlg.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"></iframe>`, ['Close'], 'Close');
  gs._answer = 'NO'; gs.menuMarkNoticesSent(); const ask = gs._alerts.pop(); gs._answer = 'YES';
  await runMenu('sent', () => null);
  await modal('Mark notices as sent?', ask.replace(/^Mark notices as sent\?\n/, ''), ['No', 'Yes'], 'Yes');
  gs.menuMarkNoticesSent(); await modal('Program', lastAlert(), ['OK'], 'OK');
  await draw('Slots', { rows: p1, flash: new Set([r24 + '|Cancellation notice sent']), label: '<span class="k-script">Filter: Slot ID starts with P1</span>' }); await wait(1600);
  // ---- 8. Who is coming ----
  await say('o8'); await caption(8);
  const r17 = rowsWhere('Slots', x => x[0] === 'P1-20261017')[0];
  await draw('Slots', { rows: p1, flash: new Set(p1.map(i => i + '|Volunteers')), label: '<span class="k-script">Filter: Slot ID starts with P1</span>' });
  await select(r17, 'Volunteers'); await wait(2000);

  // ---- End card ----
  await say('o-end');
  await card(true, `<h1>Full steps: the setup guide</h1><p>Follow-up Program · Organisers</p>`);
  await wait(Math.max(3000, stepEnd - Date.now()));
  fs.writeFileSync(VO + 'marks.json', JSON.stringify(marks));
  const vid = p.video();
  await ctx.close(); await browser.close();
  fs.renameSync(await vid.path(), OUT);
  console.log('recorded', fs.statSync(OUT).size, 'bytes');
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
