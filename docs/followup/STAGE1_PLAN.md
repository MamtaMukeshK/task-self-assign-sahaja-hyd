# Follow-up Program, stage 1: how it will be built

_Written 2026-10-07 before coding; **built the same day** (`followup/Code.gs`, `test/followup.test.js`, 8 tests passing). Follows `SPEC.md` (all decisions there are final); this file records the smaller
choices the spec leaves open. Items marked **(assumption)** should be confirmed with the user when stage 1 is shown._

## Files
- `followup/Code.gs`: the server for the new sheet (a separate Apps Script project bound to the new workbook; the tour
  page's `Code.gs` is untouched). Shared helpers (name/mobile checks, the "Name 9876543210 (via X)" cell format,
  Speakers tab) are copied from `Code.gs`, because two Apps Script projects cannot share code without a library.
- `test/followup.test.js`: tests against the simulated sheet in `test/harness.js` (the harness gets a few more stand-ins:
  script properties, delete/sort rows, dropdowns, menus, triggers, and a parameter to load a different code file).
- No page yet (stage 2), so no `doGet` yet.

## Sheet template
- Menu **Program → Set up the sheet** (`setUpSheet`) creates whatever is missing: "Program plan", "Slots", "Speakers";
  header row in bold and frozen, a note on each header saying who fills it, dropdowns (Day, Frequency, Week of month,
  Status = Open/Cancelled), date and time formats, sets the workbook's time zone to India, and turns on the weekly
  update. An existing tab is never changed.
- **"Line ID" column added as the first column of "Program plan" (assumption).** The spec's Slot ID is "plan line 3 +
  date"; row numbers change when organisers insert or sort rows, so each plan line gets a permanent ID (P1, P2...) that
  the generator fills in once. It is the only cell the script writes in "Program plan".
- **"Contact" column added to "Slots" (assumption)**, copied from the plan line, so the page reads one tab and an
  organiser can set a different contact for one date.
- Start/End cells are formatted as times ("6:30 PM"), so typing "6:30" visibly becomes "6:30 AM" and the organiser can
  correct it at once. Text without AM/PM is read as 24-hour time.

## Generator (`generateSlots`, weekly trigger Sunday 22:00 India time + menu "Program → Update slots now")
- Frequencies as decision 8. Every 2 weeks counts from the first matching day on or after From; monthly same date skips
  months without that date; One-off uses From. Past dates are never created or touched.
- **Until left empty = keep 12 weeks of dates ahead, extended every Sunday (assumption).** Any line stops 1 year ahead
  at most (guards against a mistyped year).
- Places blank = 1 (as on the tour page); 0 = closed. End blank = Start + 1 hour.
- **Plan changes (decision 9)**: the generator remembers each line's settings (script properties). Only when a line's
  settings changed does it update or remove that line's future dates **with nobody on them**; dates with volunteers are
  left alone and listed. An unchanged line only gets missing dates added, so an organiser's edits to one date (Places,
  Status, Notes) survive. A line deleted from the plan: its empty future dates are removed, booked ones listed.
- A line with a mistake (unknown frequency, missing Day, unreadable time...) is skipped and listed; its existing dates
  are not touched.
- Rows typed straight into "Slots" without a Slot ID get one (`X-20261017-1830`) on the next update; until then the page
  ignores them. To drop a date, set Status = Cancelled (a deleted row would come back on the next update).
- New rows are added in one write, then "Slots" is sorted by date and start time (rows are found by Slot ID, so sorting
  is safe). Each run's results go into an **"Update report" tab** (replaced every run); the menu also shows a summary.
- Takes the same one-at-a-time lock as registrations.

## Server functions for the page
- `getSlots(from, to, name)`: today onwards only (decision 12), shared 30-second cache per range, cleared on every write
  and on typed edits. With a name, also `mine`: every future date where that name is on the list or registered someone
  (for My Registrations and the cancellation notice). Each slot carries `started`, `ended`, `releaseClosed`.
- `registerSlots(slotIds, repeat, name, mobile, othersText, includeSelf, previewOnly)`: repeat = 1 (just this date),
  4, 8, 7, 14 or 'all', **counting the picked date** (as the mock-up does). Limits: 10 people, 100 entries. Per date:
  cancelled / started / Places 0 / no place left = skipped for everyone; a person already on it = "already"; a time
  clash (overlapping times on the same date, cancelled dates ignored) skips only that person; the rest are booked, those
  beyond the places marked "over". `previewOnly` returns the same list without writing, for the confirmation screen.
- `releaseSlot(slotId, name, personName)` and `releaseGroup(slotId, name)`: the person or their registrar only; refused
  from 12 hours before the start (India time), the message gives the date's contact. **"Release all N" also releases
  the registrar themselves if they are on that date (assumption).**
- Cancellations (data side only; the organiser's WhatsApp list screen is stage 3): cancelled dates refuse registrations
  and are flagged for the page; `cancellationList_()` returns every affected person with a ready-written English
  WhatsApp link; `markNoticeSent_(ids)` fills "Cancellation notice sent". Both are private (name ends in `_`) so the
  public page link cannot call them; stage 3 decides how the organiser's menu reaches them.
