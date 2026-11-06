# Roadmap

Goal: anyone can install Readwell, link their own Google account, and use it as their newsletter reader. Cost to run: zero. Controlled and shipped through Claude.

## Model

Each user gets their own backend by copying the Readwell Apps Script template into their Google account. It runs as them, on their mail, with their own Sheet. One shared app (a PWA on GitHub Pages) talks to whichever backend the user links. No Google verification or security assessment needed, no user cap.

## Steps

1. **Repo and structure.** Current working code in `backend/`, docs, notes for Claude. ✅
2. **Backend as an API.** `doPost` JSON endpoint for every function the UI calls, protected by a private key. Code done and live. Still to do: an API deployment with access set to "Anyone" (needs the owner's go-ahead, see below). The reader link now needs the key: add `?k=KEY` to the link.
3. **App (PWA).** Port the current UI to `app/`, swap `google.script.run` for `fetch` to the user's backend, add a first-run screen (paste backend link and key), offline cache via service worker, install prompt, app icon.
4. **Setup kit.** Template script to copy, a setup page with a 5-minute walkthrough, user-specific settings (timezone, scan hour) instead of hard-coded values.
5. **Automation.** GitHub Actions: publish `app/` to GitHub Pages on push; publish the backend as an Apps Script library version with `clasp`, so user copies get fixes.
6. **Beta.** Owner moves onto the new setup first, then invite testers.

## Later, only if there is demand

- Hosted version with Sign in with Google (needs Google verification and a yearly CASA assessment, about $540 to $720 a year).
- Or a forwarding-address version that needs no Gmail access at all.

## Open decision: the API deployment

The hosted app can only reach a user's backend if that backend has a web app deployment with access "Anyone". Google's login cookies don't travel to another site, so "Only myself" can't work from the app. The deployment is protected only by the 64-character key: anyone holding the key and the link could read and delete that user's newsletters. The owner decides whether to accept that trade-off.

## Known limits

- Apps Script cold starts: 1 to 3 seconds for an uncached call. The browser and CacheService layers hide most of it.
- Daily scan is capped by Apps Script's 6-minute run limit. Fine for personal inboxes.
- Each user sees Google's "unverified app" screen once during setup, because the script is their own.
