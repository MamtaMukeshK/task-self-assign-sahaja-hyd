# Resume here

_Last updated: 2026-10-08, end of the session that built Follow-up Program stage 2a (stage 1 the day before). Read this first, then `HANDOFF.md`
(full dated log) and, for design work, `ARCHITECTURE.md` and `docs/followup/SPEC.md`. Update this file at the end of
every session: replace "Where things stand" and "Next steps", and add to "Learnings" (never delete a learning)._

## 1. Where things stand
| Piece | State |
|---|---|
| Tour page (`Code.gs`, `Index.html`) | Version 2026-10-06.4 pushed and merged to main; **not deployed** by the user as far as we know. Live: 2026-10-01.4 (confirmed 2026-10-01). Ask the user before assuming. |
| Follow-up Program design | Final: `docs/followup/SPEC.md` + mock-up `docs/followup/mockup.html`. Build plan with the choices the spec left open: `docs/followup/STAGE1_PLAN.md`. |
| Follow-up stage 1 (server) | **Built and tested**, not run on real Google: `followup/Code.gs` + `test/followup.test.js`. |
| Follow-up stage 2a (page) | **Built and tested** in a browser against the simulated sheet, not run on real Google: `followup/Index.html` + `doGet` + `test/followup.page.test.js`. One-week calendar, date list (2 weeks, "Show 2 more weeks"), cards, select several dates, repeat, confirmation list, Release, 12-hour rule, phone/tablet/laptop. English only. |
| Follow-up stages 2b, 3, 4, 4b | Not started (register others + My Registrations + cancellation notice + Telugu/Hindi; cancellations screen + setup guide; demo videos incl. the Ongoing programs videos; organiser video). |
| Branch | `claude/vibrant-planck-gsxjay`, pushed, up to date. No pull request (the user has not asked for one). |
| Tests | `cd test && npm install && npm test`: 86 tests (77 tour page + 8 Follow-up server + 1 Follow-up page), all passing on 2026-10-08. |

## 2. Waiting on the user (do not build past these without an answer)
1. ~~Confirm the 5 stage-1 assumptions~~ **All 5 confirmed by the user 2026-10-08** (details in `docs/followup/STAGE1_PLAN.md`):
   a. "Line ID" column added to Program plan (P1, P2..., filled by the script; needed because row numbers change).
   b. "Contact" column added to Slots (copied from the plan; can differ per date).
   c. Empty "Until" = keep 12 weeks of dates ahead, topped up every Sunday; never more than 1 year ahead.
   d. "Release all N" also releases the registrar if they are on that date.
   e. Times typed without AM/PM are 24-hour; the time columns display AM/PM so mistakes show at once.
2. Stage 2 was split by the user (2026-10-08) into 2a (built) and 2b, each under 100,000 tokens. **Wait for the user to
   look at 2a and say go before building 2b.**
3. Older open items in `HANDOFF.md` "Next step": deploy tour version 2026-10-06.4; (demo videos for Ongoing programs: moved to stage 4 by the user 2026-10-08);
   native-speaker check of Telugu/Hindi; whether the built-in first-day data reaches the live tour page.

## 3. Next steps (in order)
1. The user looks at stage 2a (phone screenshot in the chat; they can also paste `followup/Code.gs` + `Index.html`
   into a test copy of a new sheet and run Program -> Set up the sheet, though the setup guide only comes in stage 3).
2. Stage 2b, in `followup/Index.html` (all wording is in its `TEXT.en` table; add `te`/`hi` blocks): "Who: Just me"
   button in the bottom bar opening the speaker list / name+mobile box / "Include me too" (copy the tour page's
   picker); pass othersText/includeSelf to `registerSlots` (the confirmation list already shows every person);
   per-person ✕ (`releaseSlot(id, name, person)`) and "Release all N for this date" (`releaseGroup`); My
   Registrations summary and the red cancellation notice at the top, both from `getSlots(...).mine`; language switch
   and translated server messages (the tour page's `SERVER_TEXT` regex approach). Extend `test/followup.page.test.js`.
   Server functions the page uses (all in `followup/Code.gs`; `doGet` already serves the page with the first 3 weeks):
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
- `test/followup.page.test.js`: one browser test of the page (calendar, repeat, confirmation, release, 12-hour rule,
  widths 320/390/1280). `SHOT=<path> npm test` also saves a phone screenshot for a visual check.
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

**Stage 2a cost** about 60,000 tokens (estimate for all of stage 2: 60,000-85,000), helped by reading only the needed
parts of the tour `Index.html` with grep/sed and writing the page in one pass from the agreed mock-up.
