# Roadmap

Goal: anyone can install Readwell, link their own Google account, and use it as their newsletter reader. Cost to run: zero. Controlled and shipped through Claude.

## Model

Each user gets their own backend by copying the Readwell Apps Script template into their Google account. It runs as them, on their mail, with their own Sheet. One shared app (a PWA on GitHub Pages) talks to whichever backend the user links. No Google verification or security assessment needed, no user cap.

## Steps

1. **Repo and structure.** Current working code in `backend/`, docs, notes for Claude. ✅
2. **Backend as an API.** `doPost` JSON endpoint for every function the UI calls, protected by a private key the user generates at setup. Keep `doGet` serving the current UI so nothing breaks.
3. **App (PWA).** Port the current UI to `app/`, swap `google.script.run` for `fetch` to the user's backend, add a first-run screen (paste backend link and key), offline cache via service worker, install prompt, app icon.
4. **Setup kit.** Template script to copy, a setup page with a 5-minute walkthrough, user-specific settings (timezone, scan hour) instead of hard-coded values.
5. **Automation.** GitHub Actions: publish `app/` to GitHub Pages on push; publish the backend as an Apps Script library version with `clasp`, so user copies get fixes.
6. **Beta.** Owner moves onto the new setup first, then invite testers.

## Later, only if there is demand

- Hosted version with Sign in with Google (needs Google verification and a yearly CASA assessment, about $540 to $720 a year).
- Or a forwarding-address version that needs no Gmail access at all.

## Known limits

- Apps Script cold starts: 1 to 3 seconds for an uncached call. The browser and CacheService layers hide most of it.
- Daily scan is capped by Apps Script's 6-minute run limit. Fine for personal inboxes.
- Each user sees Google's "unverified app" screen once during setup, because the script is their own.
