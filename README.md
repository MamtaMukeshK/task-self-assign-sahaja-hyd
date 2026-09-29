# Speaker Self-Assign page — setup guide

A one-page website where volunteers pick a school from **today's tab** of the
"Hyd 2026 permission Final list" Google Sheet. Claiming a school writes the
volunteer's name and mobile into that row of the sheet, so the sheet and the
page always show the same thing, and two people can never grab the same row.

Two files do everything: `Code.gs` (the logic) and `Index.html` (the page).


> **One-stop guide:** open **`SETUP_GUIDE.html`** (download it and double-click). It has every step
> below plus both code files with Copy buttons. After changing `Code.gs` or `Index.html`,
> rebuild it with `python3 tools/build_guide.py`.

---

## Who must do this

**Someone with EDIT access to the sheet** (ideally the owner). A "View only"
person cannot: the Extensions menu is greyed out for them, and the page writes
to the sheet *as the person who sets it up*. About 10 minutes, on a laptop.

## Before you start: check the sheet's time zone

In the sheet: **File → Settings → Time zone** must be
**(GMT+05:30) India Standard Time**. The page uses this to decide which tab is
"today". Save if you change it.

## Step 1 — Open the script editor

1. Open the Google Sheet.
2. Menu **Extensions → Apps Script**. A new tab opens with a file called `Code.gs`.
3. At the top left, click **Untitled project** and rename it to `Speaker Self-Assign`.

## Step 2 — Paste the code

1. In `Code.gs`, select everything (Ctrl+A / Cmd+A), delete it, and paste the
   full contents of the `Code.gs` file you were given.
2. In the left panel, click **+** next to **Files → HTML**. Name it exactly
   `Index` (the editor adds `.html` itself). Delete what's in it and paste the
   full contents of `Index.html`.
3. Click the **Save** icon (or Ctrl+S / Cmd+S).

## Step 3 — Give it permission (one time)

1. In the toolbar, pick the function **getState** from the dropdown, then click **Run**.
2. A box says **Authorization required** → **Review permissions** → choose your Google account.
3. Google shows **"Google hasn't verified this app"**. This is normal for your own
   scripts. Click **Advanced → Go to Speaker Self-Assign (unsafe) → Allow**.
4. The **Execution log** at the bottom should say *Execution completed*.
   - If it says **"No tab for today (…)"**, the script works; there's just no tab
     named like `28-Sep` for today yet.
   - Any other red error: send a screenshot of it.

(Only you see this warning. Volunteers using the page never see it.)

## Step 4 — Publish the page

1. Top right: **Deploy → New deployment**.
2. Click the gear next to **Select type** → **Web app**.
3. Fill in:
   - Description: `v1`
   - **Execute as: Me** (your account)
   - **Who has access: Anyone**
4. Click **Deploy**, then copy the **Web app URL** (it ends in `/exec`).
5. Open that URL yourself once to check it shows today's schools.
6. Share that URL with the volunteers, alongside the sheet link.

> If "Anyone" isn't offered (some company/school Google accounts block it),
> deploy from a personal Gmail account that has edit access to the sheet.

## Step 5 — Try it once

On the page: type a test name and mobile, click **Claim** on an open row, and
check the name appears in the speaker-name column of today's tab, with the mobile on the
line below it. No other column is touched.
Then click **Release** and check both cells are empty again.

---

## Rules for the organisers (keep these or the page stops working)

| Rule | Why |
|---|---|
| Name each day's tab like `28-Sep` (or `5-Oct` / `05-Oct`). | The page finds today's tab by this name. Tabs like `Dummy-26-Sep` or `Summary` are ignored. |
| Only one tab per date. | Otherwise the page refuses to guess and shows an error. |
| Row 1 is the header row. Exactly one header must contain the words **Speaker** and **Name** (e.g. "Sahaja Yoga ( IND) Speaker Name"). | The page writes "name, new line, mobile" into that cell only, the same way organisers already type it. Every other column (including "Local Sahaja Yogi" / "Speaker Mobile") is never touched. |
| A row is "open" when its **Speaker Name** cell is empty. | To free a slot yourself, just clear that cell in the sheet. |
| You can still edit the sheet directly as usual. | The page refreshes every 15 seconds and always shows what's in the sheet. |

At midnight India time the page automatically switches to the new day's tab.

## What volunteers see

- Today's tab with **all columns**, plus **Slots left** (e.g. "1 of 3") and **Assigned**
  (everyone on the school, with phone numbers). A **Claim** button shows on each school
  with a free slot.
- They type their name and mobile once; the browser remembers both.
- **Open only** tick box hides full schools.
- Their own rows are green with a **Release** button, which removes only their line.
- A school takes people up to its slot count: add a column whose title contains
  "Slot" (e.g. "Total Slots"). Blank or no such column = 1 person; 0 = closed.
- If people claim the last slot at the same moment, one wins and the other sees
  "No slots left: taken by …".
- A person can claim as many rows as they like.

## Updating the code later

Paste the new code, save, then **Deploy → Manage deployments → pencil icon →
Version: New version → Deploy**. The URL stays the same. (Using "New
deployment" instead would create a **new** URL.)

## Good to know

- **Names aren't verified.** Anyone with the link can type any name. It's the same
  trust level as letting people edit the sheet. People can only release their own
  place through the page; organisers can always fix things in the sheet.
- **Rows filled in by hand** (a name and number typed together in column B) show as
  taken and can only be changed in the sheet.
- **Privacy:** everything on today's tab, including speakers' mobile numbers, is
  visible to anyone with the page link. That's the same as the sheet's current
  "anyone with the link can view" sharing.
- **Capacity:** it comfortably handles dozens of people at once. Google allows
  about 30 script runs at the same moment per account, and each page refresh is a
  short run served from a 5-second shared cache.
- **Safety check:** if someone inserts, deletes or edits a row between a volunteer
  loading the page and clicking Claim, the claim is refused ("edited or moved")
  instead of landing on the wrong school.
- To test on a copy first: **File → Make a copy** of the sheet *after* Step 2. The copy
  carries its own copy of the script, attached to the copy, so deploy that one to test.
- The script works on the sheet it is attached to (Step 1). To run it as a standalone
  script instead, put the sheet's ID in `SHEET_ID` in `Code.gs`.
  To force a specific tab while testing, set `TAB_NAME_OVERRIDE: '28-Sep'`.

## For developers

`test/` holds a simulated Apps Script environment built to match the layout of the
real `27-Sep` and `28-Sep` tabs, with fake names and numbers (the live sheet couldn't be reached from the build machine).
Run the tests with `cd test && npm install && npm test`
(the page test needs a local Chromium at `/opt/pw-browsers/chromium`).
13 tests cover tab selection, claim/release, the two-people race, row-moved
protection, formula-injection and mobile validation, and a real two-browser run.
The Google lock that serialises simultaneous claims is Google's own
`LockService`. The tests simulate it; they can't exercise true parallelism.
