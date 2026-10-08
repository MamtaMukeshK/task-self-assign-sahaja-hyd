# Resume here

_Last updated: 2026-10-08, end of the session that built Follow-up Program stages 2a, 2b and 3 (stage 1 the day before). Read this first, then `HANDOFF.md`
(full dated log) and, for design work, `ARCHITECTURE.md` and `docs/followup/SPEC.md`. Update this file at the end of
every session: replace "Where things stand" and "Next steps", and add to "Learnings" (never delete a learning)._

## 1. Where things stand
| Piece | State |
|---|---|
| Tour page (`Code.gs`, `Index.html`) | Version 2026-10-06.4 pushed and merged to main; **not deployed** by the user as far as we know. Live: 2026-10-01.4 (confirmed 2026-10-01). Ask the user before assuming. |
| Follow-up Program design | Final: `docs/followup/SPEC.md` + mock-up `docs/followup/mockup.html`. Build plan with the choices the spec left open: `docs/followup/STAGE1_PLAN.md`. |
| Follow-up stage 1 (server) | **Built and tested**, not run on real Google: `followup/Code.gs` + `test/followup.test.js`. |
| Follow-up stage 2a (page) | **Built and tested** in a browser against the simulated sheet, not run on real Google: `followup/Index.html` + `doGet` + `test/followup.page.test.js`. One-week calendar, date list (2 weeks, "Show 2 more weeks"), cards, select several dates, repeat, confirmation list, Release, 12-hour rule, phone/tablet/laptop. English only. |
| Follow-up stage 2b (page) | **Built and tested** (same limits as 2a): "Who" button (speaker list with first-time mobile, typed others, Include me too), group confirmation, ✕ per person you registered, "Release all N for this date", My registrations (count + next date + Show), red cancellation notice (names the people you registered), language switch with Telugu and Hindi (**not checked by native speakers**), server messages translated. Page version followup-2026-10-08.2. |
| Follow-up stage 3 | **Built and tested** (simulated): sheet menu Program -> "Cancellation WhatsApp list" (dialog, one green Open WhatsApp button per affected person, own mobile) and "Mark cancellation notices as sent" (Yes/No naming the dates); both need the sheet's menu and return nothing, so the public link can't use them. Setup guide `followup/SETUP_GUIDE.html` (13 parts, Copy buttons) built by `tools/build_guide.py` from `tools/followup_guide_template.html`. "Who" button moved to the top under Mobile (user request). Version followup-2026-10-08.3. |
| Follow-up stages 4, 4b | Not started (demo videos in 3 languages incl. the Ongoing programs videos; organiser video). |
| Branch | `claude/vibrant-planck-gsxjay`, pushed, up to date. No pull request (the user has not asked for one). |
| Tests | `cd test && npm install && npm test`: 89 tests (77 tour page + 9 Follow-up server + 3 Follow-up page/guide), all passing on 2026-10-08. |

## 2. Waiting on the user (do not build past these without an answer)
1. ~~Confirm the 5 stage-1 assumptions~~ **All 5 confirmed by the user 2026-10-08** (details in `docs/followup/STAGE1_PLAN.md`):
   a. "Line ID" column added to Program plan (P1, P2..., filled by the script; needed because row numbers change).
   b. "Contact" column added to Slots (copied from the plan; can differ per date).
   c. Empty "Until" = keep 12 weeks of dates ahead, topped up every Sunday; never more than 1 year ahead.
   d. "Release all N" also releases the registrar if they are on that date.
   e. Times typed without AM/PM are 24-hour; the time columns display AM/PM so mistakes show at once.
2. **The user sets up the new sheet with `followup/SETUP_GUIDE.html` (first run on real Google) and reports what they
   see.** Fix whatever differs before stage 4. Ideally a native Telugu and a native Hindi speaker check the page's
   wording (`TEXT.te` / `TEXT.hi` in `followup/Index.html`).
3. Older open items in `HANDOFF.md` "Next step": deploy tour version 2026-10-06.4; (demo videos for Ongoing programs: moved to stage 4 by the user 2026-10-08);
   native-speaker check of Telugu/Hindi; whether the built-in first-day data reaches the live tour page.

## 3. Next steps (in order)
1. The user follows `followup/SETUP_GUIDE.html` on real Google. Things to watch in their report (all moderate
   confidence, never seen on real Google): the "Program" menu appears; set-up creates the tabs and the Sunday trigger;
   '2026-10-17' / '18:30' written by the generator become a real date and time; times show as "6:30 PM"; the page loads
   with the first 3 weeks; the WhatsApp dialog's links open WhatsApp (dialogs are sandboxed; `<base target="_blank">`).
2. Stage 4 (demo videos for the Follow-up page in English, Telugu, Hindi, plus the Ongoing programs videos moved here
   by the user) and 4b (organiser video): see SPEC section 5 and HANDOFF "Re-record the demo". Narration text approved
   by the user first. Low-confidence estimates: 60,000-100,000 and 30,000-50,000 tokens; split if over 100,000.
   Server functions the page uses, for reference (all in `followup/Code.gs`; `doGet` serves the first 3 weeks):
   - `getSlots(from, to, name)` -> `{from, to, today, now, slots[], mine[], speakers[], version}`; each slot
     `{id, line, date 'yyyy-MM-dd', day 0-6, start/end 'HH:mm', centre, address, map, contact, places, cancelled, notes,
     people[{name, phone, by}], remaining, over, started, ended, releaseClosed}`. `mine` = every future date where the
     name is on the list or registered someone (My Registrations + cancellation notice).
   - `registerSlots(ids[], repeat, name, mobile, othersText, includeSelf, previewOnly)`; repeat = 1, 4, 8, 7, 14 or
     'all', counting the picked date. Returns `{preview, results[{id, date, start, end, centre, people[{name, self,
     status: booked|over|already|skipped, reason: cancelled|started|closed|full|clash, clash}]}], missing[], tally,
     slots[]}`. Call with previewOnly = true for the confirmation screen, then again to write.
   - `releaseSlot(id, name, personName?)`, `releaseGroup(id, name)` -> `{removed[], slot}`.
3. Stage 3: organiser menu item + dialog for the WhatsApp list (uses the private `cancellationList_` and
   `markNoticeSent_`; decide how the dialog reaches them without making them callable from the public page), and a
   setup guide for the new sheet (like `tools/build_guide.py` builds `SETUP_GUIDE.html`). First real Google check.
4. Stages 4 and 4b: demo videos (see SPEC section 5 and HANDOFF "Re-record the demo").
5. Stop and ask before any stage passes 100,000 tokens.

## 4. Map of the Follow-up files
- `followup/Code.gs`: sections in order: menu/setup/triggers; generator (`generateSlots`, `readPlan_`,
  `parsePlanLine_`, `planDates_`); reading Slots (`readTable_`, `readSlots_`, `pageSlot_`); page functions; cancellations;
  date/time helpers; helpers copied from the tour `Code.gs` (bottom of the file - keep both copies in step if one is fixed).
- `followup/Index.html`: the volunteers' page (no framework; `render()` draws calendar, list, bar from `state`; dates are
  'yyyy-MM-dd' keys and "today"/"now" come from the server, never the browser clock). Logo and font link were copied
  from the tour `Index.html` by a script (the logo is a long data address; do not read it into context).
- `test/followup.test.js`: `setup(planLines)` builds a Program plan + empty Slots; "now" is Wed 7 Oct 2026 05:00.
- `test/followup.page.test.js`: two browser tests: (1) calendar, repeat, confirmation, release, 12-hour rule, widths
  320/390/1280; (2) register others, ✕, Release all, My registrations, cancellation notice, Telugu/Hindi + a translated
  server message. Helper `openPage(browser, gs, width, name, mobile)` opens the page with a remembered name - use it
  for new tests. `SHOT=<path>` / `SHOT2=<path>` save phone screenshots for a visual check.
- `test/harness.js`: `load(sheets, now, 'followup/Code.gs')` loads the new server; stand-ins added this session:
  `PropertiesService`, `ScriptApp` triggers (`ctx._triggers`), `getUi().alert` (`ctx._alerts`), dropdown builder,
  `deleteRow`, `insertRowsAfter`/`getMaxRows`, `Range.sort`, `setFrozenRows`, `setFontWeight`, `setNotes`.

## 5. Learnings (add new ones; keep old ones)
**Working with this user**
- Plain language, no unexplained abbreviations, state confidence, small changes, commit and push as you go.
- Budget: 100,000 tokens per stage. Tell the user and get approval before going over (done this session with a
  multiple-choice question; they approved up to 125,000). Report the count at the end.
- Measure tokens from the "total_tokens left" counter (low-moderate confidence in how it works): it was back at
  15,000,000 at the start of each new user message. On the first message of a session its first step dropped about
  69,000 (instructions and tools being read for the first time), which is start-up, not task work; later messages only
  count new work. Report task tokens as the counter's drop, minus that start-up on a session's first message.
- **Long design thinking is the biggest cost**: about 40,000 tokens went on working out stage 1's design in one go.
  Next time write decisions straight into a plan file in short steps, and read only the parts of big files you need
  (`Code.gs` 35 KB, `HANDOFF.md` 30 KB, `Index.html` 100 KB - never read `Index.html` whole).
- Stage 1 actual: about 117,000 task tokens against an estimate of 40,000-60,000 (spec). Treat the remaining
  stage estimates in SPEC section 5 as low by up to 2 times.

**Design facts settled this session**
- The mock-up counts the picked date in a repeat: "next 4 dates" = the picked date + 3 more.
- Slots rows are found by Slot ID (`P3-20261017`; hand-typed rows get `X-20261017-1830`), never by row number, so
  the generator may sort and delete rows.
- Plan changes are detected by remembering each line's settings in script properties (`line:P3`); an unchanged line
  only gets missing dates added, so organisers' edits to single dates survive. A cleared Line ID gets its old ID back
  when the settings match.

**Google Apps Script (moderate confidence, not yet checked on real Google)**
- Writing the strings '2026-10-17' and '18:30' with `setValues` should turn into a real date and time (like typing).
- Time-only cells read with `getValues()` come back as 1899 dates with odd offsets in India time; read times from
  display values instead.
- A date cell must be turned into 'yyyy-MM-dd' using the **spreadsheet's** time zone, not CONFIG.TIME_ZONE. The tour
  `Code.gs` `dateKey_` uses CONFIG.TIME_ZONE (fine while the sheet is set to India time; not changed - mention if the
  user ever reports dates one day off).
- Functions whose names end in `_` cannot be called from the page (`google.script.run`) or from sheet menus. Every
  other function in the project can be called by anyone with the page link.
- Simple `onOpen` can add a menu; creating a trigger needs a menu click (authorisation), so `setUpSheet` does it.

**Testing**
- In "Register others" text, a digit at the end of a name merges with the phone ("P1 9000000001" is read as an
  11-digit number). Use letters in test names.
- `Infinity % 1` is `NaN`: the "whole program" repeat was rejected until the check allowed Infinity (caught by a test).
- The tests use the harness clock in UTC and treat it as India time; write fixture dates as 'yyyy-MM-dd' strings.
- The harness clock is frozen (`new Date()` is always "now"), so anything keyed on the current time never changes in
  tests. The cache refresh used a time stamp and served stale dates in the browser test; it now uses a counter
  (also safer on real Google). Prefer counters over time stamps for "something changed" markers.
- Count test expectations by hand carefully (the week total was 6, not 9): when a browser test fails, print the page
  text at that step before changing code.
- Card grid `minmax(min(340px, 100%), 1fr)` gives 3 columns at 1280 px, 2 on tablets, 1 on phones, and never overflows
  a 320 px phone; plain `minmax(300px, 1fr)` gave 4 columns on a laptop.

- Reuse the tour tests' steps (the user's request 2026-10-08): copying their flow and assertion style for "register
  others" and "language switch" made the 2b test quick to write. Same for wording: the tour page's Telugu/Hindi for
  shared phrases was pulled out of its `TEXT` table by a script, so both pages say the same thing.
- Playwright `check()` re-finds its element after the click: a locator like "the input in Meena's row" breaks once the
  page adds a mobile box to that row; target `input[type=checkbox]`.
- Ticked speakers stay chosen after a booking (the group can book more dates); tests that book again must count them.

- The user may send new requests mid-turn (2026-10-08: "reuse tour tests", "move the Who button to the top"): fold
  them into the current stage, test them, and list them in the summary.
- Organiser-only actions: put them behind a sheet menu item that asks with `ui.alert(..., ButtonSet.YES_NO)` and
  returns nothing; never a public function that writes or returns personal data without needing the sheet's menu.
- Counting words in generated HTML counts instructions too ("Open WhatsApp" appeared in the tip text): count the
  actual elements (links) instead.
- Guide templates: `tools/followup_guide_template.html` reuses the tour guide's head/style/Copy-button script
  (assembled once by a script); `tools/build_guide.py` builds both guides; a browser test checks the Copy boxes equal the files.

**Stage 3 cost** about 40,000 tokens. **Stage 2b cost** about 65,000 tokens. **Stage 2a cost** about 60,000 tokens (estimate for all of stage 2: 60,000-85,000), helped by reading only the needed
parts of the tour `Index.html` with grep/sed and writing the page in one pass from the agreed mock-up.
