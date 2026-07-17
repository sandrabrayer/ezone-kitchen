# Google Apps Script + Sheet setup

This is the backend for ezone-kitchen. You do this **once** in Google, then put
three values into Railway. The code is [`../apps-script/Code.gs`](../apps-script/Code.gs).

> ⚠️ **The golden rule of this ecosystem:** Apps Script never auto-syncs from
> GitHub. When you change `Code.gs`, you **paste it in, Save, and publish a NEW
> VERSION of the EXISTING deployment** (the pencil ✏️ icon). **Never create a
> new deployment** — a new deployment gets a new `/exec` URL, and the server
> stops working until you update `APPS_SCRIPT_URL`.

## 1. Create the Sheet

1. Go to <https://sheets.google.com> and create a blank spreadsheet.
2. Name it e.g. **ezone-kitchen data**. You don't need to add any tabs — the
   script creates them (with headers) on first use.

## 2. Add the bound Apps Script

1. In the Sheet: **Extensions → Apps Script**. This opens a script **bound** to
   this Sheet (important — the script writes to *this* spreadsheet).
2. Delete the default `function myFunction() {}`.
3. Open [`apps-script/Code.gs`](../apps-script/Code.gs) from this repo, copy its
   **entire** contents, and paste into the editor.
4. Click **Save** (💾).

## 3. Set the shared secret (Script Property)

1. In the Apps Script editor: **Project Settings** (the ⚙️ gear on the left).
2. Scroll to **Script Properties → Add script property**.
3. Property: `SHARED_SECRET`  ·  Value: a long random string. Generate one with
   `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`.
4. **Save script properties.** Keep this value — it must match Railway's
   `APPS_SCRIPT_SECRET` exactly.

## 4. Deploy as a Web App

First time only (creating the single deployment you will reuse forever):

1. **Deploy → New deployment**.
2. Gear next to "Select type" → **Web app**.
3. Configure:
   - **Description:** `ezone-kitchen`
   - **Execute as:** **Me** (your Google account — so it can write the Sheet).
   - **Who has access:** **Anyone**. (The server-side `SHARED_SECRET` is what
     actually authorizes writes; "Anyone" only means Google won't show its own
     login page, which would break the JSON response.)
4. **Deploy**, authorize the scopes when prompted.
5. Copy the **Web app URL** — it ends in `/exec`. This is `APPS_SCRIPT_URL`.

## 5. Put the values in Railway

Set these environment variables on the Railway service (see
[`DEPLOYMENT.md`](DEPLOYMENT.md)):

| Railway variable     | Value                                             |
| -------------------- | ------------------------------------------------- |
| `APPS_SCRIPT_URL`    | the `/exec` URL from step 4                        |
| `APPS_SCRIPT_SECRET` | the same string as the `SHARED_SECRET` from step 3 |

There are no auth/login variables — the app is open.

## 6. Verify

- Open the deployed app (no login). On the **first** load, when the `houses` tab
  is empty, the backend seeds the five production houses automatically
  (`ramot-hashavim`, `raanana-asher`, `caesarea-ofroni`, `caesarea-rehab`,
  `pardes`). Then check the Sheet — a `houses` tab (and others) should appear and
  fill in. The seed is idempotent: it only runs on an empty tab, so it never
  duplicates and never overwrites a house you later rename.
- Everyone who opens the app gets the house switcher and every tab; there is
  nothing to configure per user.
- Direct `GET` on the `/exec` URL returns `{"ok":true,"service":"ezone-kitchen",
  "note":"POST only"}` — that confirms it's live. All real calls are POST and go
  through the server.

## Updating the backend later (the important part)

1. Edit `apps-script/Code.gs` in the repo (and commit it).
2. In the Apps Script editor, paste the new contents over the old, **Save**.
3. **Deploy → Manage deployments → (your deployment) → ✏️ Edit → Version: New
   version → Deploy.**
4. The `/exec` URL stays the same, so nothing else needs to change.

Do **not** use "New deployment" for updates.
