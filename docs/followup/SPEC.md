# Follow-up Program sign-up (per-date slots) - design spec

_Agreed with the user 2026-10-07 in a design session. Nothing built yet. Clickable mock-up: `docs/followup/mockup.html`
(also published at https://claude.ai/artifact/ESNid5pMiVY5HG4cBoXYhc, version 4). Read `ARCHITECTURE.md` first._

## 0. Two questions to settle before building (raised by the overlap with "Ongoing programs")
"Ongoing programs" (v2026-10-06.x, `docs/ongoing-programs-design.md`) was designed in a parallel session: one row per
program on an "Ongoing" tab of the tour sheet; a sign-up commits to **every** date of the program; **Primary/Backup**
roles. This spec is a different model: **each date is its own slot**, booked and released one by one, on a **separate
sheet and page link**.
1. **Relationship:** does this follow-up program page *replace* "Ongoing programs" for long-running programs, or do
   both exist (Ongoing = whole-program commitment inside the tour page; this = per-date booking for the new program)?
   Recommended: both exist for now; decide after organisers have used both.
2. **Primary/Backup on per-date slots?** The mock-up has one role. If backups matter here too, each slot gets a
   Backup count and Register asks "Primary or Backup" (as Ongoing does). Recommended: ask the organisers; add it only
   if they need it (it doubles the counts on every card and the repeat logic must apply per role).

## 1. Decisions (all agreed)
| # | Topic | Decision |
|---|---|---|
| 1 | Layout | **Option C**: a two-week calendar block (7 columns Mon-Sun, a full week per row, 2 rows), **large ‹ › arrow buttons** at the edges moving 2 weeks, **month name** between them (e.g. "October 2026", "Oct – Nov 2026"; a small month tag on the 1st). Each date shows the number of sessions with places left (green/amber/grey) and a green dot where you are registered; today outlined; past/empty dates dimmed. Below it, a list of the **next 2 weeks**; **"Show 2 more weeks"** adds 2 weeks; tapping a date further ahead extends the list to it and scrolls there. |
| 2 | Multi-select | Tick several slots across days, then **Register once** (bottom bar: count, Clear, repeat choice, Register). |
| 3 | Repeat | "Just this date / Same session, next 4 dates / next 8 dates / whole program". For **daily** sessions: "Just this day / next 7 days / next 14 days / whole program". Counted in dates of the same plan line, so it works for every frequency. Full or cancelled dates are skipped and listed. |
| 4 | Booking horizon | Volunteers may book **the whole program** (every generated date). |
| 5 | Release | Each booked date has its own **Release** ("this date"); other dates stay booked. **Allowed until 12 hours before the start**; after that the card says "Release closed - under 12 h to go" and shows the organiser's phone. Enforced on the server too. |
| 6 | Late sign-up | **Registering stays open until the session starts** (fills last-minute gaps). |
| 7 | Generation | A **time-driven trigger every Sunday night** (Asia/Kolkata) generates dates from the Program plan up to each line's Until date; organisers can also run it from a sheet menu ("Program → Update slots now"). |
| 8 | Frequencies | Daily · Daily, weekdays only (Mon-Fri) · Weekly · Every 2 weeks · Monthly, same weekday (1st/2nd/3rd/4th/last, e.g. "2nd Saturday") · Monthly, same date (e.g. the 15th) · One-off. |
| 9 | Plan changes | The generator never deletes or moves a date that has volunteers; changed plan lines update only future dates with nobody on them; the rest are listed for organisers to decide. |
| 10 | Cancellation | Organisers set Status = "Cancelled" on a date's row. The page strikes it through for everyone; volunteers on it see a **red notice at the top** ("⚠ Cancelled: … please don't go. Your other dates are unchanged."). Plus an **organiser WhatsApp list**: a sheet menu opens the affected volunteers with a ready-written message each (one tap per person); "Cancellation notice sent" records it. Email/SMS: not now. |
| 11 | Sheet & link | A **new sheet and its own page link**; the current tour sheet and page are untouched. |
| 12 | Page reads | Only the **coming weeks** (today onwards, plus what the volunteer has scrolled/tapped to); past dates are not sent to the page. |

## 2. Sheet (new workbook)
**Tab "Program plan"** (typed by organisers; one line per regular session):
Day (Monday…Sunday, or "Every day") | Start | End | Frequency (dropdown, list in decision 8) | Week of month (for
"Monthly, same weekday": 1st/2nd/3rd/4th/last) | Day of month (for "Monthly, same date") | Centre | Address | Google map |
Places | From | Until | Contact (name + phone, shown when release is closed) | Notes.
- Every 2 weeks counts from the first matching day on or after From. Monthly same date: months without that date
  (e.g. 31st) are skipped (to confirm with organisers). One-off: From is the date.

**Tab "Slots"** (written by the generator; organisers may edit Status/Notes/Places, add one-off rows):
Slot ID (e.g. `P3-20261017` = plan line 3 + date; never reused) | Date | Day | Start | End | Centre | Address | Map |
Places | Status (Open / Cancelled) | **Volunteers** (page writes; same cell format as today: one person per line,
"Name 9876543210", "(via X)") | **Still needed** (page writes) | **Cancellation notice sent** (WhatsApp-list tool
writes) | Notes.
- Identify rows by Slot ID, not row number, so sorting or inserting rows is safe.
- Speakers tab as today (name list on the page).

## 3. Server (new Apps Script project bound to the new sheet; reuse patterns from Code.gs)
- `getSlots(fromDate, toDate)`: Open + Cancelled slots in the range (cached per range, cleared on writes/edits as today).
- `registerSlots(slotIds[], repeatChoice, name, mobile, others…)`: one lock; expand the repeat; for each date re-read
  the row, refuse/skip full, cancelled, started, or clashing (same person, overlapping time); write; return a per-date
  result list (booked / skipped with reason) for the confirmation sheet.
- `releaseSlot(slotId, name)`: refuse inside 12 hours of the start (server clock, Asia/Kolkata), else remove the name.
- `generateSlots()`: trigger + menu; idempotent by Slot ID; never touches rows with volunteers except Status/Notes.
- `cancellationList()`: for Cancelled rows with volunteers and no notice sent, return name, phone and a prefilled
  WhatsApp link (`https://wa.me/91XXXXXXXXXX?text=…`); mark sent when the organiser confirms.

## 4. Page (new Index.html based on the current one)
- Header, language switch (en/te/hi), name/mobile (remembered), large text (as v2026-10-01.x).
- Option C calendar + list as in decision 1; cards: time, centre · area, places badge, people, Select/Selected,
  Full, Ended, Cancelled (struck through), your dates (Release / Release closed + organiser phone).
- My Registrations summary (count + next date) and cancellation alerts above the list; "Open only".
- Register others ("via" you) and the Speakers list as today.
- Demo videos later (separate task).

## 5. Build plan (a fresh session; each stage confirmed with the user before the next)
1. Sheet template + generator + server functions + tests (simulated sheet, all frequencies, edge dates). ~40-60k tokens.
2. Page: calendar + list + multi-select + repeat + release rules, phone/tablet/laptop, en/te/hi. ~50-70k tokens.
3. Cancellations: page notice + organiser WhatsApp list menu; setup guide for the new sheet. ~25-40k tokens.
Estimates have moderate confidence. Stop and ask before any stage passes 100,000 tokens.
