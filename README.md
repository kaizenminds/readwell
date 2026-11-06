# Readwell

A calm, dark reader for your email newsletters. It pulls newsletters out of Gmail, lets you read them in one place, highlight and tag what matters, and clears out the rest.

Everything runs inside your own Google account. Readwell has no servers and never sees your mail.

## What it does

- **Finds newsletters for you.** A daily scan spots new senders. You decide who gets in with one tap: Add or Ignore.
- **Keeps Gmail clean.** Newsletters from added senders skip your inbox and land in Readwell.
- **Reading, not triage.** Dark interface, newsletters keep their own design, one scrolling page, toolbar that gets out of the way.
- **Highlights and tags.** Select text to highlight it, add notes and tags, find everything later in one view.
- **Auto-cleanup.** Read newsletters older than 5 days are deleted unless you saved, tagged, starred or highlighted them.
- **Works on phone, tablet and laptop**, in portrait and landscape.

## How it is built

| Part | Where it runs | Folder |
|---|---|---|
| Backend: Gmail scan, sender rules, cleanup, storage | Google Apps Script, in the user's own account | `backend/` |
| App: the reader UI | Installable web app (PWA) on GitHub Pages, talks only to the user's own backend. The older reader served by Apps Script still works | `app/` |
| Data | Gmail labels plus a Google Sheet in the user's Drive | created on setup |

## Status

Beta. The installable app and setup page are built; first customer tests are next. See [docs/roadmap.md](docs/roadmap.md).

## Set it up for yourself (current version)

Open the setup page in the app (`app/setup.html`), or see [docs/setup.md](docs/setup.md). About 5 minutes.
