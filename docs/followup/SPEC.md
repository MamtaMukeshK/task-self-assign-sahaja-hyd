# Follow-up Program sign-up (per-date slots) - design spec

_Agreed with the user 2026-10-07 in a design session; all decisions final, ready to build. Nothing built yet. Clickable mock-up: `docs/followup/mockup.html`
(also published at https://claude.ai/artifact/ESNid5pMiVY5HG4cBoXYhc, version 4). Read `ARCHITECTURE.md` first._

## 0. Relationship to "Ongoing programs" (decided 2026-10-07)
"Ongoing programs" (v2026-10-06.x, `docs/ongoing-programs-design.md`) was designed in a parallel session: one row per
program on an "Ongoing" tab of the tour sheet; a sign-up commits to **every** date; **Primary/Backup** roles. This spec
is a different model: **each date is its own slot**, booked and released one by one, on a **separate sheet and link**.
1. **Both exist for now:** "Ongoing programs" stays in the tour page for whole-program commitments; this page is for
   per-date booking in the new follow-up program. Revisit after organisers have used both.
2. **One role (no Primary/Backup) on per-date slots for now.** Add Backup later only if organisers ask (each slot would
   get a backup count and Register would ask "Primary or Backup", as Ongoing does).

## 1. Decisions (all agreed)
| # | Topic | Decision |
|---|---|---|
| 1 | Layout | **Option C, "One week" layout (confirmed by the user 2026-10-07)**: the current week on two rows of large day boxes, **Mon–Thu** on top and **Fri–Sun + a "This week: N open" box** below (about twice the size of a 7-column grid). Each box: weekday ("Today" for today), date (month tag on the 1st and on the first box), "N open" / "full" / "past", "● You" where registered. **Large ‹ › arrow buttons** at the edges move **one week**; the **month name** and date range sit between them. (The mock-up also has a "Next 8 days" switch, used only for comparison: do not build it.) Below: a list of the **next 2 weeks**; **"Show 2 more weeks"** adds 2 weeks; tapping a date further ahead extends the list to it and scrolls there. |
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
| 13 | Register others (decided 2026-10-07) | **"Who: Just me ▾"** button in the bottom bar opens the same speaker list / name+mobile box / "Include me too" as today; the bar then reads e.g. "3 people · 2 slots · next 4 dates → Register". One Register books **the whole group on every chosen date** (selected slots × repeat), each entry "Name mobile (via Registrar)". A confirmation lists each date and who goes on it before anything is written. **Not enough places (decision a, option C):** if a date has at least one place left, the whole group is booked and anyone beyond the limit is shown in red as over the limit (as on the tour page); a date that is already full (0 places) is skipped, as it is for one person. **Time clash:** only the person who clashes is skipped on that date; the rest are booked, and the summary names who was skipped and why. **Limits:** at most 10 people and 100 entries (people × dates) per Register, with a clear message when exceeded. **Release:** per date, each registered person has a ✕ (registrar removes just that person) plus a "Release all N for this date" button; each person can also release themselves with their own name; the 12-hour rule applies to all of these. **My Registrations** counts dates where you are on the list or registered someone ("Sat 17 Oct · you + 2 others"); cancellation notices reach the registrar for those dates, and the organiser WhatsApp list includes every affected person (their own mobile), not only the registrar. Trust model unchanged: anyone with the link can register any name; only the person or their registrar can release them through the page. |

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
- `registerSlots(slotIds[], repeatChoice, name, mobile, othersText, includeSelf)`: one lock; enforce the limits
  (10 people, 100 entries); expand the repeat; for each date re-read the row; skip cancelled, started or already-full
  (0 places) dates; skip only the clashing person (same person, overlapping time); otherwise add everyone (extras beyond
  the places are allowed and flagged); write; return a per-date, per-person result list (booked / over limit / skipped
  with reason) for the confirmation sheet.
- `releaseSlot(slotId, name, personName?)`: refuse inside 12 hours of the start (server clock, Asia/Kolkata); remove
  the person if the caller is that person or their registrar ("via"); `releaseGroup(slotId, name)` removes everyone the
  caller registered on that date (same rule).
- `generateSlots()`: trigger + menu; idempotent by Slot ID; never touches rows with volunteers except Status/Notes.
- `cancellationList()`: for Cancelled rows with volunteers and no notice sent, return every affected person (including
  people registered by others, using their own mobile) with name, phone and a prefilled
  WhatsApp link (`https://wa.me/91XXXXXXXXXX?text=…`); mark sent when the organiser confirms.

## 4. Page (new Index.html based on the current one)
- Header, language switch (en/te/hi), name/mobile (remembered), large text (as v2026-10-01.x).
- Option C calendar + list as in decision 1; cards: time, centre · area, places badge, people, Select/Selected,
  Full, Ended, Cancelled (struck through), your dates (Release / Release closed + organiser phone).
- My Registrations summary (count + next date) and cancellation alerts above the list; "Open only".
- Register others as in decision 13 ("Who" button in the bottom bar, group confirmation, per-person ✕, "Release all N
  for this date", over-limit names in red); Speakers list as today (new people added to it).
- Demo videos later (separate task).

## 5. Build plan (a fresh session; each stage confirmed with the user before the next)
1. Sheet template + generator + server functions + tests (simulated sheet, all frequencies, edge dates). ~40-60k tokens.
2. Page: calendar + list + multi-select + repeat + release rules + register others, phone/tablet/laptop, en/te/hi.
   ~60-85k tokens (register others adds ~15-25k across stages 1 and 2).
3. Cancellations: page notice + organiser WhatsApp list menu; setup guide for the new sheet. ~25-40k tokens.
4. **Demo videos in English, Telugu and Hindi, and the demo button** (added by the user 2026-10-07). A gold "Watch the
   1-minute demo" button at the top of the new page, as on the tour page today, playing the video for the page's
   language (`DEMO_VIDEO_URLS.en/.te/.hi`: the organiser's Google Drive link first, GitHub copies as fallback).
   Record on a phone screen with the existing tooling (`tools/record_demo.js`, `tools/voiceover/`: English Kokoro
   voice, Hindi Piper "Priyamvada", Telugu AI4Bharat; see HANDOFF "Re-record the demo"), using demo data for the new
   sheet (made-up names). Steps to show: pick dates on the one-week calendar, select two sessions, repeat for the
   next 4 dates, register others, Register; see them under My Registrations; release one date; a cancelled date's
   notice; changing language. First write the narration lines and captions in all three languages and get the user's
   (and ideally native speakers') OK before recording. Then the user uploads the three videos to Drive ("Anyone with
   the link") and sends the links; put them in `DEMO_VIDEO_URLS`. ~60-100k tokens (low confidence; the Telugu voice
   setup alone is a large download, see HANDOFF).
Estimates have moderate confidence (stage 4: low). Stop and ask before any stage passes 100,000 tokens.
