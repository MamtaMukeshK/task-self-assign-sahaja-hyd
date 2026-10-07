// Follow-up Program server (followup/Code.gs) against the simulated sheet. "Now" is Wed 7 Oct 2026, 05:00.
const test = require('node:test'), assert = require('node:assert');
const { load, makeSheet } = require('./harness');
const NOW = new Date(Date.UTC(2026, 9, 7, 5, 0));
const PH = ['Line ID', 'Day', 'Start', 'End', 'Frequency', 'Week of month', 'Day of month', 'Centre', 'Address', 'Google map',
  'Places', 'From', 'Until', 'Contact', 'Notes'];
const SH = ['Slot ID', 'Date', 'Day', 'Start', 'End', 'Centre', 'Address', 'Map', 'Contact', 'Places', 'Status', 'Volunteers',
  'Still needed', 'Cancellation notice sent', 'Notes'];
const S = h => SH.indexOf(h);
function setup(lines, now) {
  const plan = makeSheet('Program plan', 1, [PH, ...lines.map(o => PH.map(h => o[h] == null ? '' : o[h]))]);
  const slots = makeSheet('Slots', 2, [SH]);
  const gs = load([plan, slots], now || NOW, 'followup/Code.gs');
  return { gs, plan, slots, row: id => slots.grid.find(r => r[0] === id), dates: p => slots.grid.filter(r => String(r[0]).startsWith(p + '-')).map(r => r[1]) };
}
const weekly = { Day: 'Saturday', Start: '6:30 PM', End: '7:30 PM', Frequency: 'Weekly', Centre: 'Ameerpet', Places: '2',
  From: '2026-10-01', Until: '2026-10-31', Contact: 'Lakshmi 9000000009' };

test('setUpSheet creates the three tabs with dropdowns and one weekly trigger; a second run changes nothing', () => {
  const gs = load([], NOW, 'followup/Code.gs'), ss = gs.SpreadsheetApp.getActiveSpreadsheet();
  assert.match(gs.setUpSheet(), /Created: Program plan, Slots, Speakers\. The weekly update/);
  assert.deepEqual(ss.getSheetByName('Program plan').grid[0].slice(0, 15), PH);
  assert.deepEqual(ss.getSheetByName('Slots').grid[0].slice(0, 15), SH);
  assert.deepEqual(gs._triggers, [{ handler: 'generateSlots', day: 'SUNDAY', hour: 22, tz: 'Asia/Kolkata' }]);
  assert.match(gs.setUpSheet(), /^All tabs were already there/);
  assert.equal(gs._triggers.length, 1);
});

test('generator: every frequency, from today on only, with permanent line IDs; running again adds nothing', () => {
  const t = setup([
    { Day: 'Every day', Start: '7:00 AM', Frequency: 'Daily', From: '2026-10-05', Until: '2026-10-10' },
    { Start: '18:00', Frequency: 'Daily, weekdays only (Mon-Fri)', From: '2026-10-07', Until: '2026-10-13' },
    weekly,
    { Day: 'Saturday', Start: '10am', Frequency: 'Every 2 weeks', From: '2026-10-03', Until: '2026-11-14' },
    { Day: 'Saturday', Start: '9:00 AM', Frequency: 'Monthly, same weekday', 'Week of month': '2nd', From: '2026-10-01', Until: '2026-12-31' },
    { Day: 'Sunday', Start: '9:00 AM', Frequency: 'Monthly, same weekday', 'Week of month': 'last', From: '2026-10-01', Until: '2026-12-31' },
    { Start: '9:00 AM', Frequency: 'Monthly, same date', 'Day of month': '31', From: '2026-10-01', Until: '2026-12-31' },
    { Start: '5:00 PM', Frequency: 'One-off', From: '2026-10-20' }]);
  const r = t.gs.generateSlots();
  assert.deepEqual(t.plan.grid.slice(1).map(x => x[0]), ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8']);
  assert.deepEqual(t.dates('P1'), ['2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10'], 'daily: past dates not made');
  assert.deepEqual(t.dates('P2'), ['2026-10-07', '2026-10-08', '2026-10-09', '2026-10-12', '2026-10-13']);
  assert.deepEqual(t.dates('P3'), ['2026-10-10', '2026-10-17', '2026-10-24', '2026-10-31']);
  assert.deepEqual(t.dates('P4'), ['2026-10-17', '2026-10-31', '2026-11-14'], 'every 2 weeks counts from 3 Oct');
  assert.deepEqual(t.dates('P5'), ['2026-10-10', '2026-11-14', '2026-12-12']);
  assert.deepEqual(t.dates('P6'), ['2026-10-25', '2026-11-29', '2026-12-27']);
  assert.deepEqual(t.dates('P7'), ['2026-10-31', '2026-12-31'], 'November has no 31st');
  assert.deepEqual(t.dates('P8'), ['2026-10-20']);
  const p3 = t.row('P3-20261017');
  assert.deepEqual([p3[S('Day')], p3[S('Start')], p3[S('End')], p3[S('Places')], p3[S('Status')], p3[S('Still needed')], p3[S('Contact')]],
    ['Sat', '18:30', '19:30', 2, 'Open', 2, 'Lakshmi 9000000009']);
  assert.equal(t.row('P8-20261020')[S('End')], '18:00', 'blank End = 1 hour');
  const all = t.slots.grid.slice(1).map(x => x[1] + x[3]);
  assert.deepEqual(all, all.slice().sort(), 'Slots sorted by date and start');
  assert.equal(r.added, all.length);
  assert.equal(t.gs.generateSlots().added, 0);
  assert.match(t.gs.SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Update report').grid[1][0], /0 added, 0 changed, 0 removed/);
});

test('generator: a changed line updates only empty future dates; booked dates are kept and listed; mistakes are skipped', () => {
  const t = setup([weekly, { Day: 'Funday', Start: '6:30 PM', Frequency: 'Weekly', From: '2026-10-01' }]);
  t.gs.generateSlots();
  t.gs.registerSlots(['P1-20261017'], 1, 'Asha', '9876543210');
  t.plan.grid[1][PH.indexOf('Start')] = '7:00 PM';
  t.plan.grid[1][PH.indexOf('Until')] = '2026-10-24';
  const r = t.gs.generateSlots();
  assert.deepEqual(t.dates('P1'), ['2026-10-10', '2026-10-17', '2026-10-24'], '31 Oct removed (nobody on it)');
  assert.equal(t.row('P1-20261010')[S('Start')], '19:00');
  assert.equal(r.notes.filter(n => /Funday|Day must be a weekday/.test(n)).length, 1, 'bad line reported');
  assert.equal(t.plan.grid[2][0], '', 'bad line gets no ID');
});

test('generator keeps booked dates when the plan moves them', () => {
  const t = setup([weekly]);
  t.gs.generateSlots();
  t.gs.registerSlots(['P1-20261017'], 1, 'Asha', '9876543210');
  t.plan.grid[1][PH.indexOf('Start')] = '7:00 PM';
  t.plan.grid[1][PH.indexOf('Until')] = '2026-10-10';
  const r = t.gs.generateSlots();
  assert.deepEqual(t.dates('P1'), ['2026-10-10', '2026-10-17']);
  assert.equal(t.row('P1-20261017')[S('Start')], '18:30', 'booked date not changed');
  assert.match(r.notes.join('\n'), /Sat 17 Oct 2026: 1 volunteer\(s\) on it, so it was kept/);
  t.plan.grid[1][0] = ''; // ID cleared by mistake: same settings get the same ID back
  t.gs.generateSlots();
  assert.equal(t.plan.grid[1][0], 'P1');
});

test('register: repeat counts the picked date; others are "(via)"; full dates skipped; over the limit flagged; preview writes nothing', () => {
  const t = setup([weekly]);
  t.gs.generateSlots();
  const pre = t.gs.registerSlots(['P1-20261010'], 4, 'Asha', '98765 43210', 'Ravi 9123456789\nMeena 9234567890', true, true);
  assert.equal(pre.results.length, 4);
  assert.equal(t.row('P1-20261010')[S('Volunteers')], '', 'preview did not write');
  t.gs.registerSlots(['P1-20261024'], 1, 'Gita', '9345678901', 'Hari 9456789012');
  const r = t.gs.registerSlots(['P1-20261010'], 4, 'Asha', '98765 43210', 'Ravi 9123456789\nMeena 9234567890');
  assert.deepEqual(r.results.map(d => d.date), ['2026-10-10', '2026-10-17', '2026-10-24', '2026-10-31']);
  assert.deepEqual(r.results[0].people.map(p => p.status), ['booked', 'booked', 'over']);
  assert.deepEqual(r.results[2].people.map(p => p.reason), ['full', 'full', 'full']);
  assert.equal(t.row('P1-20261010')[S('Volunteers')], 'Asha 9876543210\nRavi 9123456789 (via Asha)\nMeena 9234567890 (via Asha)');
  assert.equal(t.row('P1-20261010')[S('Still needed')], 0);
  assert.deepEqual(r.tally, { booked: 6, over: 3, already: 0, skipped: 3 });
  assert.equal(t.gs.registerSlots(['P1-20261010'], 1, 'asha', '9876543210').results[0].people[0].status, 'already');
  const sp = t.gs.SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Speakers').grid.map(x => x[1]);
  assert.ok(['Asha', 'Ravi', 'Meena', 'Gita', 'Hari'].every(n => sp.includes(n)), 'new people added to Speakers');
});

test('register: a clash skips only that person; cancelled and started dates are skipped; limits of 10 people and 100 entries', () => {
  const t = setup([{ Day: 'Every day', Start: '4:00 AM', End: '6:00 AM', Frequency: 'Daily', From: '2026-10-07', Until: '2026-10-08', Places: '5' },
    { Start: '4:30 PM', Frequency: 'Daily', From: '2026-10-07', Until: '2026-12-31', Places: '5' },
    { Start: '5:00 PM', Frequency: 'One-off', From: '2026-10-07' }]);
  t.gs.generateSlots();
  t.gs.registerSlots(['P2-20261007'], 1, 'Asha', '9876543210');
  const r = t.gs.registerSlots(['P3-20261007', 'P1-20261007'], 1, 'Ravi', '9123456789', 'Asha 9876543210');
  const one = r.results.find(d => d.id === 'P3-20261007').people;
  assert.deepEqual(one.map(p => [p.name, p.status, p.reason]), [['Ravi', 'booked', undefined], ['Asha', 'skipped', 'clash']]);
  assert.equal(one[1].clash.id, 'P2-20261007');
  assert.deepEqual(r.results.find(d => d.id === 'P1-20261007').people.map(p => p.reason), ['started', 'started'], '4 AM slot started at 5 AM');
  t.row('P1-20261008')[S('Status')] = 'Cancelled';
  assert.equal(t.gs.registerSlots(['P1-20261008'], 1, 'Ravi', '9123456789').results[0].people[0].reason, 'cancelled');
  const eleven = Array.from({ length: 10 }, (_, i) => 'Person ' + 'ABCDEFGHIJ'[i] + ' 90000000' + String(i).padStart(2, '0')).join('\n');
  assert.throws(() => t.gs.registerSlots(['P2-20261008'], 1, 'Ravi', '9123456789', eleven), /at most 10 people/);
  assert.equal(t.gs.registerSlots(['P2-20261008'], 'all', 'Ravi', '9123456789').results.length, 85, 'whole program: 8 Oct to 31 Dec');
  assert.throws(() => t.gs.registerSlots(['P2-20261008'], 'all', 'Ravi', '9123456789', 'Hari 9456789012'), /The most at one time is 100/);
});

test('release: person or registrar only; the 12-hour rule gives the contact; "release all" takes the whole group', () => {
  const t = setup([{ ...weekly, Day: 'Every day', Frequency: 'Daily', Start: '4:00 PM', End: '5:00 PM', From: '2026-10-07', Until: '2026-10-08', Places: '5' }]);
  t.gs.generateSlots();
  t.gs.registerSlots(['P1-20261007'], 2, 'Asha', '9876543210', 'Ravi 9123456789\nMeena 9234567890');
  assert.throws(() => t.gs.releaseSlot('P1-20261008', 'Gita', 'Ravi'), /Only Ravi or Asha can remove Ravi/);
  assert.throws(() => t.gs.releaseSlot('P1-20261007', 'Asha'), /under 12 hours to go\. Please call the organiser \(Lakshmi 9000000009\)/);
  assert.deepEqual(t.gs.releaseSlot('P1-20261008', 'Ravi').removed, ['Ravi'], 'a person releases themselves');
  assert.deepEqual(t.gs.releaseSlot('P1-20261008', 'Asha', 'Meena').removed, ['Meena'], 'the registrar removes one person');
  assert.equal(t.row('P1-20261008')[S('Volunteers')], 'Asha 9876543210');
  t.gs.registerSlots(['P1-20261008'], 1, 'Asha', '9876543210', 'Hari 9456789012');
  const g = t.gs.releaseGroup('P1-20261008', 'asha');
  assert.deepEqual(g.removed, ['Asha', 'Hari']);
  assert.equal(t.row('P1-20261008')[S('Volunteers')], '');
  assert.equal(t.row('P1-20261008')[S('Still needed')], 5);
});

test('getSlots: today onwards only, my dates, flags; cancellation list with WhatsApp links', () => {
  const t = setup([{ ...weekly, Day: 'Every day', Frequency: 'Daily', Start: '4:00 PM', From: '2026-10-07', Until: '2026-10-20' }]);
  t.gs.generateSlots();
  t.gs.registerSlots(['P1-20261007'], 1, 'Ravi', '9123456789', 'Asha 9876543210', false);
  t.gs.registerSlots(['P1-20261019'], 1, 'Asha', '9876543210');
  t.row('P1-20261019')[S('Status')] = 'Cancelled';
  t.gs.onEdit({});
  const s = t.gs.getSlots('2026-10-01', '2026-10-09', 'ravi');
  assert.deepEqual([s.from, s.to, s.slots.length], ['2026-10-07', '2026-10-09', 3]);
  assert.deepEqual(s.slots[0].people, [{ name: 'Asha', phone: '9876543210', by: 'Ravi' }]);
  assert.deepEqual([s.slots[0].started, s.slots[0].releaseClosed, s.slots[1].releaseClosed], [false, true, false]);
  assert.deepEqual(s.mine.map(x => x.id), ['P1-20261007'], 'registrar sees the date they booked for someone else');
  assert.deepEqual(t.gs.getSlots('', '', 'Asha').mine.map(x => [x.id, x.cancelled]), [['P1-20261007', false], ['P1-20261019', true]]);
  const list = t.gs.cancellationList_();
  assert.equal(list.length, 1);
  assert.match(list[0].people[0].link, /^https:\/\/wa\.me\/919876543210\?text=Namaste%20Asha\.%20The%20Follow-up%20Program%20session%20on%20Mon%2019%20Oct%202026%20at%204%3A00%20PM/);
  t.gs.markNoticeSent_(['P1-20261019']);
  assert.match(t.row('P1-20261019')[S('Cancellation notice sent')], /^Sent 7 Oct 05:00$/);
  assert.equal(t.gs.cancellationList_().length, 0);
});
