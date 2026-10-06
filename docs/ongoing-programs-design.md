# Ongoing Programs - design proposal

_Status 2026-10-06: BUILT as version 2026-10-06.1 (option A, every recommended answer in section 3 accepted; the user added
that ended programs are never open for sign-up). Not deployed yet. One change from below: the new columns are read on the
Ongoing tab only (safer for date tabs). Details of what was built: HANDOFF.md, 2026-10-06 entries._

## 1. The brief (from the user, ARCHITECTURE.md section 11 format)

- **Feature:** Ongoing Programs - sign-ups for programs that run continuously (no single date).
- **Who:** volunteers and organisers, mostly phones, sometimes computers.
- **Steps asked for:**
  1. The date drop-down also offers "Ongoing"; picking it shows every program on the sheet's "Ongoing" tab.
  2. Programs show as cards like a date's schools, but a volunteer can register as **Primary** or as **Backup**, each
     with its own places; both behave like today's registration (allowed when full, with the warning).
  3. Cards show frequency, days of the week, timings, location, contacts and other details.
  4. Register and release work for both roles, as for speakers today.
  5. Cards show the start and end dates (e.g. "15th Sep 2026 to 31st Mar 2027"), frequency
     (Daily/Weekly/Monthly/Custom), days of the week and the time.
  6. Only sessions whose first occurrence (date + time) is on or after today can be signed up for; past ones are greyed
     out; "Open only" shows only open ones.
- **New data:** "Ongoing" tab with new columns Backup Yogis Name, Backup yogis needed, Num of backup yogis still needed
  (kept up to date by the app), Frequency, Days of the Week.
- **Must keep working:** everything as today; My Registrations shows a person's sign-ups in both roles.
- **Languages:** English, Telugu, Hindi. **Deadline:** before the next volunteer sign-up cycle (date not given).

## 2. What the real "Ongoing" tab looks like

From `30_Sep_Assignments_-_Testing_SheetNew.xlsx` (sent 2026-10-06; not committed - it holds phone numbers).
Columns: A Sl.No, B "Sahaja Yoga ( IND) Speaker Name", C Total volunteers Needed, D Number of Volunteers still Needed,
E Backup Yogis Name, F Backup yogis needed, G Num of backup yogis still needed, H Frequency, I Time,
J Days of the Week, K Institution name, L Branch / Address, M Google map, N Total No of Students, O Principal Name,
P RI, Q Phone No, R Remarks, S Approval Obtained By, T Approval ... Contact number, U Zone, V Distance from Ashram,
W Direction. Three programs:

| Sl.No | Frequency | Days of the Week | Time | Primary (C/D) | Backup (F/G) |
| --- | --- | --- | --- | --- | --- |
| 1 | Weekly | Wed | 9.30 am | blank / blank | blank / blank |
| 2 | Custom | Tue, Thu | 4 to 5pm - 1 or 2 sessions... | 4 / 3 (one person on it) | blank / blank |
| 3 | Daily | Mon, Tue, Wed, Thu, Fri | 3 to 4pm | 2 / 2 | blank / blank |

Findings:
- **No start date or end date columns exist**, yet brief items 5 and 6 need them.
- Backup "needed" is blank on every row (today's rule for the primary column: blank = 1 place, 0 = closed).
- "Daily" is used for Monday-Friday, so the Days column, not the Frequency word, says which days a program runs.
- The existing header rules still find exactly one column each on this tab (speaker name = B, total = C,
  still needed = D, time = I); the new backup headers don't collide with them (checked by hand).
- Today the app ignores this tab (only tabs named like `30-Sep` are listed).

## 3. Questions to settle (recommended answer first)

1. **What does a sign-up mean?** (a) a commitment to the whole program, every listed day until it ends - recommended,
   it matches one name per line in one cell; or (b) a sign-up for one particular date - a much larger change
   (each person's line would need a date, the card would need a date picker).
2. **When is a program closed for sign-up?** The brief's rule ("first occurrence on or after today") would grey out
   every program that has already started - e.g. one running 15-Sep-2026 to 31-Mar-2027 would be closed today,
   6-Oct, although it is running and may need people. Recommended: open until its end date (and that day's end time)
   has passed; programs that haven't started are open (sign up in advance); no end date = always open.
   Either way, organisers must add two columns, e.g. **"Start Date"** and **"End Date"**, typed as real sheet dates.
3. **Blank "Backup yogis needed":** same rule as the primary column (blank = 1 place, 0 = no backups) -
   recommended for consistency; or blank = no backup role offered.
4. **Same person as Primary and Backup on one program?** Recommended: refused, with a clear message.
5. **Time clashes on Ongoing:** recommended - a clash only when the same start time falls on a shared weekday while
   both programs' dates overlap, counting both roles. Not checked between Ongoing and date tabs (dates are not checked
   against each other today either).
6. **My Registrations:** recommended - as today, for the chosen view only (on Ongoing it lists your programs, each
   marked Primary or Backup). Showing everything across all dates and Ongoing at once means reading every tab on
   every 15-second refresh: slower and heavier on Google's limits.
7. **"Open only" on Ongoing:** recommended - shows programs that haven't ended and have a place left in either role.
8. **Drop-down:** recommended - "Ongoing programs" as the last entry; the page still opens on today's date (on Ongoing
   only if there are no date tabs at all).
9. **Date wording:** recommended "15 Sep 2026 to 31 Mar 2027" (no "th"; the same in all three languages, month names
   as in the date drop-down). Monthly/Custom are shown as typed; the app does not work out individual dates.
10. **Deadline:** which date is the next sign-up cycle? **Volume:** roughly how many ongoing programs?
11. **Demo videos:** re-record after organisers have tried the feature (separate task)?

## 4. Options

| | A. Extend what exists (recommended) | B. Separate Ongoing code | C. No backup columns |
| --- | --- | --- | --- |
| Idea | Ongoing tab = one more entry in the drop-down; a row may carry a second role (backup) when its tab has backup columns; the same server functions take an optional "role" | New server functions and a new drawing function only for Ongoing | Organisers list each program twice (one row for primary, one for backup) |
| Pros | One code path: both roles get everything today's registration has (full warning, red over-limit, Register others, via, Speakers tab); least code | Date tabs' code untouched: lowest risk to current users | Least code: only the drop-down entry, dates, closed rule, clash rule |
| Cons | Touches the core write function, so current users are exposed to any mistake (guarded by the 70 existing tests plus new ones) | About twice the code to write and keep in step; costs more tokens | Doesn't meet the brief; doubles organisers' rows; roles told apart only by row text |
| Confidence it's right | High | | |

## 5. Design A in detail

- **Sheet:** organisers add "Start Date" and "End Date" to the Ongoing tab (per question 2). Nothing else changes.
  The app writes only: primary name cell, primary still-needed cell, backup name cell, backup still-needed cell,
  and the Speakers tab (rule 1 of ARCHITECTURE.md extended to the two backup cells).
- **Server (Code.gs):**
  - The tab named "Ongoing" (any letter case; "Ongoing Programs" too) is listed after the date tabs, flagged as ongoing.
  - `readTab_` also finds backup name / backup needed / backup still-needed / start date / end date / days columns by
    header words; each row gets a `backup` part (people, total, remaining, over), dates and weekdays. The fingerprint
    leaves out the four cells the app writes, so a primary and a backup sign-up by different people never block each other.
  - `claimRow`, `releaseRow`, `removePerson` take one more, optional input: the role. Left out = primary, so pages
    already open on phones keep working during the switch-over.
  - Closed rule and clash rule per questions 2 and 5. Dates read as real dates (not text), so day/month order can't be
    misread.
- **Page (Index.html):**
  - Drop-down entry "Ongoing programs" (en/te/hi).
  - On Ongoing, each card: Sl.No + institution; a "when" line: dates, frequency, days, time; a **Primary** block
    (places left, Register as primary / Release, names) and a **Backup** block (the same); address, map, Details.
    Laptop table gets "Backup places left" and "Backup volunteers" columns. The sheet's own backup columns are hidden
    as duplicates (as the speaker column is today).
  - My Registrations and "Open only" per questions 6 and 7.
  - About 10-15 new phrases in each language (Telugu/Hindi need a native speaker's check, as before).
- **Tests:** new server tests (both roles: register, release, remove, still-needed cells, fingerprint independence,
  closed rule, clash rule, header finding, drop-down entry, date tabs unchanged) and page tests (drop-down, cards with
  both roles, My Registrations, Open only, languages). All existing tests must keep passing.
- Also fix the 1-pixel frozen-column test failure found 2026-10-06 (HANDOFF.md).

## 6. What changes for current users

- One new entry at the bottom of the date drop-down. Date tabs look and behave exactly as before (they have no backup
  columns, so no backup buttons). The backup, date and weekday columns are read on the Ongoing tab only.
- The organiser pastes the two files and deploys a new version, as usual.

## 7. Estimate (tokens, as counted in the session; moderate confidence, +/- 30%)

- Phase 1 - server + server tests + handoff: about 50,000-65,000.
- Phase 2 - page + translations + page tests + pixel fix + version, guide, handoff: about 65,000-85,000.
- Together about 115,000-150,000: over the 100,000-per-task limit, so proposed as two tasks, each under 100,000.
- Optional later: demo videos in three languages, about 40,000-60,000 (low confidence).
