# Readwell app

The installable web app (PWA). Published to GitHub Pages from this folder.

- `index.html` the reader. Generated from `backend/Index.html` by `tools/build_app.py`, so the UI is written once. Do not edit it by hand.
- `setup.html` the 5-minute setup walkthrough for new users.
- `manifest.webmanifest`, `icons/`, `sw.js` install and offline support.

The app talks only to the backend the user connects: a POST with `{key, fn, args}` to their own Apps Script web app. The link and key are kept in the device's localStorage (`rw_conn`). A connect link looks like `https://<pages-site>/#connect=<backend link>&key=<key>`; the app reads it, checks it with `ping`, then removes it from the address bar.
