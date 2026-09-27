# Handoff / status

_Last updated: 2026-09-27_

## Done
- `Code.gs` + `Index.html`: Apps Script web app that opens today's tab (named like `28-Sep`)
  of the sheet it is attached to (no sheet ID in the code), shows all columns, and lets
  volunteers claim open rows (empty cell under the header containing "speaker" + "name") by
  writing the name there, and the mobile into a "speaker" + "mobile" column if the tab has one,
  else on a second line under the name (27-Sep style). Release allowed only by the same name
  (first line of the cell).
- Concurrency: `LockService` script lock + re-check inside the lock; row fingerprint rejects
  claims on rows that were edited/moved since page load; 5-second shared `CacheService` read cache.
- 13 tests green (12 logic tests against a simulated Apps Script + 1 two-user browser test).
- `README.md`: step-by-step setup guide for the sheet editor.

## Not yet done / not verified
- Never run on real Google Apps Script or against the live sheet (build machine had no access
  to docs.google.com). First real check = README Step 5.
- Must be deployed by someone with EDIT access (the requester has View only).
- 2026-09-27: user's live test on a copy got as far as `getState` → found the `27-Sep` tab but the
  header differed ("Sahaja Yoga ( IND) Speaker Name", no mobile column) → fixed with word-based
  header matching.
- 2026-09-27: LIVE TEST PASSED on the user's own copy of the sheet (deployed web app):
  page load on 27-Sep, claim, release, two-device race, sheet→page refresh all confirmed.
- Only the `27-Sep` and `28-Sep` layouts were seen (via screenshots). Other tabs may differ;
  if not, the page errors loudly rather than guessing.

## Next step
0. Check the 29-Sep, 30-Sep and 1-Oct tab layouts (user sending screenshots).
Sheet editor follows README Steps 1–5 and sends back the `/exec` link. Then fix anything the
live run reveals (most likely: header text or tab-name differences).
