# Working on Readwell

Readwell is a Gmail newsletter reader. Every user runs their own copy of the backend in their own Google account. There is no central server and no shared database. Keep it that way unless the owner decides otherwise: it is what keeps the product free and outside Google's restricted-scope review.

## Layout

- `backend/` Google Apps Script project (pushed with `clasp`).
  - `Code.gs` all server logic: Gmail scan, sender detection, rules, cleanup, storage, cache.
  - `Index.html` the current reader UI, served by `doGet()`. Single file: HTML, CSS and JS together.
  - `appsscript.json` manifest. The Gmail advanced service must stay enabled (permanent delete uses it).
- `app/` the installable web app (PWA), published to GitHub Pages by `.github/workflows/pages.yml` on every push to `app/**`.
  - `index.html` is generated from `backend/Index.html` by `tools/build_app.py`. Never edit it by hand: change `backend/Index.html` (or the build script for app-only parts), then run `python3 tools/build_app.py`.
  - `setup.html` the customer walkthrough. `TEMPLATE_URL` in it points at the shared template script once it exists.
  - `sw.js` caches the app shell only. It must never cache calls to a user's backend.
- `docs/` setup guide and roadmap.

## Rules

- Product owner: Kush. Confirm before large rewrites or anything that changes what users' data or mail goes through.
- Never add code that deletes mail without an explicit user action or the user's auto-cleanup setting being on.
- Never send user data anywhere except the user's own Google account.
- Keep `Index.html` free of backticks and `${`: the file has been pasted into the Apps Script editor through a JavaScript template string.
- Server calls from the UI go through `run()` (shows the loading bar) or `bg()` (fire and forget). UI updates first, server second.
- Test UI changes against a mock `google.script.run` (and, for `app/`, a mock of the backend's fetch API served over a local http server) in headless Chromium at phone portrait, phone landscape, iPad portrait, iPad landscape and desktop sizes before shipping.
- Copy for users: plain, short, no em dashes.

## Deploying the owner's own copy

Until GitHub Actions + clasp are wired up (roadmap step 5), the live copy is updated by pasting files into the Apps Script editor and publishing a new version of the existing web app deployment (same URL). Verify the editor contents by SHA-256 against the repo before saving.

## API

- `doPost` takes a text/plain JSON body `{key, fn, args}` and only runs functions listed in `api_()`.
- The key lives in the owner's user properties. `showMyKey()` prints it in the editor log, `connectLink()` prints a one-tap connect link for the app, Settings in the old reader shows it, `rotateApiKey()` replaces it and signs out every device.
- Opening the web app link without a key never shows the key. It queues `setup()` in the background (first visit only) and emails the owner, from and to their own Gmail, a connect link, at most once every 10 minutes. `connectLink()` and `rotateApiKey()` also email the link.
- `doGet` only serves the reader when the link carries the key (`?k=`). Personal Gmail accounts don't reveal the viewer to the script, so an owner check by email doesn't work.
- Never change a deployment's access settings without the owner's explicit go-ahead.

## Key behaviour to preserve

- Daily trigger at the user's scan hour and timezone (user properties `SCAN_HOUR`, `TZ`; default 7 AM, Asia/Kolkata; the app moves it to the device's timezone on first connect) runs `scan()`: files mail from added senders, lists new candidate senders, then runs cleanup if enabled. `scanNow()` (the Check now button) never cleans up.
- Adding a sender files their last 5 days immediately.
- Auto-cleanup is off until the user turns it on. `setup()` never deletes mail.
- Remove sender blocks the whole company domain, except shared domains (Gmail, Substack and similar), where only that address is blocked.
- Cleanup keeps anything saved, tagged, highlighted or starred in Gmail.
- Startup is one `bootstrap()` call, served from CacheService when warm, plus the browser's own localStorage copy.
