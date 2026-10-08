# How the app is built (for designing new features)

_Written 2026-10-06 against version 2026-10-01.4; updated for 2026-10-06.1 (Ongoing programs). `HANDOFF.md` is the dated log of what changed and why; this file
explains how the pieces fit, what limits we work within, and what to decide before a redesign._

## 1. What it is, in one paragraph
A one-page website for the "Hyderabad 2026 - Self Realization Tour". Volunteers open a link, pick a date, see the
schools for that day, and tap **Register** (or **Release**). Their name and mobile go straight into the organisers'
Google Sheet, which stays the single source of truth: organisers keep editing the sheet as usual, and the page shows
what the sheet says. Dozens of people use it at the same time, mostly on phones; many are elderly; English, Telugu
and Hindi.

## 2. The pieces
```
 Volunteers' browsers (phone / tablet / laptop)
        |  page: Index.html (HTML + CSS + JavaScript in one file)
        |  calls the server with google.script.run (getState, claimRow, releaseRow, removePerson)
        v
 Google Apps Script web app: Code.gs  (bound to the sheet; deployed "Execute as: Me", "Who has access: Anyone")
        |  reads/writes with SpreadsheetApp; LockService for one-at-a-time writes; CacheService for shared reads
        v
 The Google Sheet (organisers own it): one tab per day ("30-Sep"), plus a "Speaker(s)" tab
```
- **No other servers, database or accounts.** Everything runs inside Google, under the organiser's account.
- **Deploying = pasting two files** (`Code.gs`, `Index.html`) into the sheet's Apps Script editor, then
  Deploy -> Manage deployments -> New version. `SETUP_GUIDE.html` (built by `tools/build_guide.py`) carries both files.

## 3. The data (the sheet is the database)
- **Day tabs** are named like `30-Sep` / `1-Oct` (current year). Other tabs are ignored. One tab per date.
- **Row 1 is the header row.** Columns are found by words in their headers, so organisers can rename/reorder freely:

  | Role | Header must contain | Written by the app? |
  |---|---|---|
  | Who is on the school (one cell lists everyone) | "speaker" + "name" | **Yes** - the only cell a registration writes |
  | Places per school | "total" + "volunteer" | No (blank = 1, 0 = closed) |
  | Places still needed | "still" + "volunteer" | Yes, kept up to date (skipped if it holds a formula) |
  | Start/end time (free text, e.g. "2pm to 3pm") | "time" | No |
  | Serial number | "S No" / "Sl No" / "Sr. No." | No (shown first as "Sl.No") |
  | Everything else (school, address, map link, contacts, remarks...) | anything | No - shown as-is |
- **Ongoing tab** (named `Ongoing` or `Ongoing Programs`): one program per row, listed after the dates as "Ongoing
  programs". Same columns as a day tab, plus - read on this tab only - backups ("backup"+"name", written by the app),
  backups needed ("backup"+"needed", blank = 1, 0 = none), backups still needed ("backup"+"still", kept up to date),
  "start"+"date" / "end"+"date" (real sheet dates, or day-first text) and "days" ("Mon, Thu", "Mon to Fri"; none named
  = every day). Frequency is shown as typed. A program is closed once its end date (and, that day, its end time) has
  passed; one person can't be primary and backup on the same program; a clash there = same start time + a shared
  weekday + both still running.
- **Speaker cell format:** one person per line, `Name 9876543210`; people registered by someone else end with
  `(via Priya)`. Older hand-typed entries like `Ramesh<newline>98...` are understood (a person ends at the line that
  holds their phone). This text format *is* the data model - there is no hidden table.
- **Speaker(s) tab:** Sr. No., Speaker, Mobile (+ anything else). Feeds the name list on the page; everyone
  registered through the page is added (or has a missing mobile filled in). Created if missing.
- **Not stored anywhere:** history/audit of who changed what (only Google's own version history), user accounts,
  preferences (name/mobile/language live only in each browser's local storage).

## 4. Server (Code.gs) - main functions
| Function | Job |
|---|---|
| `doGet()` | Serves the page, with the first day's data already inside (`/*INITIAL_STATE*/null` placeholder, `<` escaped) |
| `getState(tab)` | Returns everything the page needs for one day (see shape below) |
| `claimRow / releaseRow / removePerson` -> `mutate_()` | All writes. Take the script lock, **re-read the row**, check it wasn't edited/moved (fingerprint), check past/ended slot and time clash, write the speaker cell (+ "still needed"), update the Speaker tab, clear the cache |
| `listDays_ / resolveDay_ / dayIsOver_ / markPast_` | Which tabs are days; default day = today, or the next day once all of today's timed slots are over; past/ended flags |
| `readTab_ / parseAssignees_ / startTime_ / endTime_` | Turn a tab into rows; parse the speaker cell and free-text times |
| `cachedState_ / onEdit` | Shared 30-second cache per tab; cleared on every write, on typed edits (simple `onEdit` trigger) and when the sheet's size changes |
| `CONFIG` (top of file) | Header words, time zone (Asia/Kolkata), cache/lock settings, Speaker tab names |

**State shape** returned by `getState`:
`{ tab, headers[], nameIdx, slotsHeader, rows: [{ row, fp, cells[], speaker, assignees: [{name, phone, by, text}],
total, remaining, over, timeText, start, end, past }], days: [{name, label, past, today}], defaultDay, speakers:
[{name, mobile}], clock, version, pastDay, size }`. On the Ongoing tab also `ongoing: true, backupIdx, today`, each row
`backup: {assignees, total, remaining, over}, startDate, endDate` ('yyyy-MM-dd' or '') and `days` (0 = Sunday, or null), and
the Ongoing entry in `days` has `ongoing: true`. `claimRow/releaseRow/removePerson` take an optional last input `role`
('backup'; left out = primary).

## 5. Page (Index.html) - how it works
- **One file**: styles, the `TEXT` translation table (en/te/hi), and all the JavaScript. No framework, no build step.
- **`render()`** draws two tables from the state: **My Registrations** (`#mine`: rows with your typed name, or that
  you registered someone into) and **All Schools** (`#grid`, filtered by "Open only"). Cells get a "kind" from their
  header (school / time / address / map / duplicate / more).
- **Layouts by width, CSS only:** <= 700 px phone cards (contacts behind "Details"); 701-1100 px tablet cards (all
  shown); > 1100 px laptop table with frozen first columns (`pinColumns`).
- **Ongoing tab:** one card per program with the same cells as a date tab: one places badge for both roles, one names
  list (backups tagged), and Register asks "Primary or Backup?" (`askRow`) unless only one role has places.
- **Refresh:** every 15 s while visible, and on returning to the tab; days already seen show instantly (`dayCache`).
- **Identity:** whatever is typed in "Your name" (+ mobile), remembered in the browser. "Mine" = same name, ignoring case.
- **Demo videos:** `DEMO_VIDEO_URLS.en/.te/.hi` - each a Google Drive link (opens Drive's player) then GitHub copies.

## 6. Rules the current design relies on (change with care)
1. **Only the speaker cell, the "still needed" cell, on the Ongoing tab the backup and backups-still-needed cells, and
   the Speaker tab are ever written.** Everything else is the
   organisers'.
2. **Every write re-reads the live row inside the lock** and refuses if the row changed since the page loaded
   (fingerprint excludes the speaker and "still needed" cells). Display can be slightly stale; writes never are.
3. **Over-booking is allowed but shown in red** (organisers' choice); time clashes for the same person are refused.
4. **Past days and ended slots are view-only.**
5. **No sign-in.** Anyone with the link can register any name - the same trust level as an editable sheet. Only the
   person (or whoever registered them) can release them through the page; organisers can fix anything in the sheet.
6. **Privacy:** every column of a day tab, including phone numbers, is visible to anyone with the link.

## 7. Platform limits to design around (Google Apps Script, free/consumer account)
_Numbers are Google's published quotas as I know them (moderate confidence) - check
https://developers.google.com/apps-script/guides/services/quotas before relying on one._
- About **30 script runs at the same moment** per account; each page refresh is one short run. Fine for dozens of
  users, tight for hundreds refreshing every 15 s.
- One run may last at most **6 minutes**; the write lock is one-at-a-time across all users.
- **Cache values max 100 KB** each (a very large day tab would fall back to uncached reads).
- **Time-driven triggers** (e.g. for reminders) have a daily total-runtime quota; **sending SMS/WhatsApp is not
  built in** - it needs a paid provider (Indian SMS also needs DLT registration).
- The page runs inside Google's sandboxed frame with Google's banner; no custom domain; first load includes 1-2 s of
  Google start-up. Measured live load: about 2.3-2.4 s (computer and phone, 2026-10-01).
- No user sign-in without asking every volunteer to log in with a Google account (deployment "Execute as user").

## 8. Where new features fit easily, and where they don't
- **Easy (hours):** new read-only information from new sheet columns; new filters/sort; new sections or wording on
  the page; new per-row rules that only read the sheet; more languages (add a `TEXT` block).
- **Moderate (a day or two):** new kinds of writes to new columns or a new tab (follow `mutate_`: lock, re-read,
  fingerprint, clear cache); organiser-only views protected by a simple shared code; calendar ("add to my phone")
  buttons; scheduled jobs with time-driven triggers.
- **Hard / consider a different platform:** real user accounts and permissions; automatic SMS/WhatsApp;
  hundreds of simultaneous users with live updates; storing lots of history or analytics; offline use. A move
  would most likely keep the Sheet as the data and replace only the web page/server part (e.g. a small hosted app
  using the Google Sheets API) - a big step; decide only when a feature truly needs it.

## 9. Testing and release
- `test/harness.js` imitates the Google services (sheets, lock, cache, HTML) in memory; `test/code.test.js` covers the
  server logic; `test/page.test.js` drives the real page in Chromium (two users racing, cards, languages, speed...).
  `cd test && npm install && npm test` - 77 tests, all must pass. Add tests for every new behaviour.
- For every page change: bump `VERSION` in `Code.gs` (and the same string in `test/code.test.js`), run
  `python3 tools/build_guide.py`, commit, push, send the user `SETUP_GUIDE.html`; the user pastes and deploys a New
  version. If the change shows on screen, ask whether the demo videos need re-recording (`tools/record_demo.js`).

## 10. Before designing a new feature - questions to settle with the user
1. Who uses it (volunteers, organisers, both) and on what device?
2. What exactly do they see and do, step by step? Any example from the real sheet?
3. Does it need new data? Where does it live - a new column, a new tab, or outside the sheet?
4. Does anyone other than the person themselves need to be able to change it? (Trust/permissions.)
5. Does it need to happen automatically at a time (reminders, summaries)? Through which channel?
6. How many people at once, and how fresh must the information be?
7. Must it work in Telugu and Hindi too? Should the demo videos change?
8. What must NOT change for current users (they're mid-tour)?
9. Deadline: before which tour date?

## 11. Feature brief (copy into your first message to a new session and fill in)
```
Feature name:
Problem it solves (who is stuck, and how today):
Who uses it (volunteers / organisers / both), on what devices:
What they should see and do, step by step:
New information needed, and where it comes from (sheet column/tab, typed on the page, other):
Must keep working as today:
Languages:
Deadline / tour dates it must be ready for:
Anything you have already tried or ruled out:
```

## 12. Second app in this repository: Follow-up Program sign-up (2026-10-07)
A separate sheet, Apps Script project and page link; the tour app above is unchanged. Design: `docs/followup/SPEC.md`;
build choices: `docs/followup/STAGE1_PLAN.md`; state and server functions: `resume.md`. Server: `followup/Code.gs`
(stage 1 built); setup guide: `followup/SETUP_GUIDE.html` (stage 3, with the organiser's WhatsApp-list menu); page: `followup/Index.html` (stages 2a and 2b built 2026-10-08: calendar, list, select, repeat, confirmation, release,
register others, My Registrations, the cancellation notice, Telugu/Hindi). Data: "Program plan" tab (one line per regular
session, one value per column, permanent Line ID; titles since 2026-10-08: Day of the Week, Start Time, End Time,
Institution Name, Volunteers Needed, Principal Contact, Sahaji Contact) -> generator -> "Slots" tab (one row per date, found by Slot ID, Volunteers cell in the
same format as the tour's speaker cell). Same rules as section 6, plus: release closes 12 hours before the start;
the generator never changes past dates or dates with volunteers.
