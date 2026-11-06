# Set up Readwell (current version)

About 10 minutes. You need a Google account with Gmail.

## 1. Create the project

1. Go to [script.google.com](https://script.google.com) and click **New project**.
2. Rename it **Readwell**.
3. Replace the contents of `Code.gs` with [`backend/Code.gs`](../backend/Code.gs).
4. Click **+** next to Files, choose **HTML**, name it `Index`, and paste in [`backend/Index.html`](../backend/Index.html).
5. Next to **Services**, click **+**, pick **Gmail API**, keep the identifier `Gmail`, click **Add**.
6. Save with Cmd+S or Ctrl+S.

## 2. Authorise and run setup

1. Pick `setup` in the function menu and click **Run**.
2. Approve the permissions. Google warns that the app is unverified because it is your own script. Click **Advanced**, then **Go to Readwell**.
3. Setup creates the data Sheet in your Drive, the Gmail labels, and the daily 7 AM scan, then looks back 30 days.

## 3. Publish it

1. **Deploy** → **New deployment** → type **Web app**.
2. Execute as **Me**, access **Only myself**. Click **Deploy**.
3. Open the web app link. That is your reader.

## 4. Put it on your phone

Open the link in Safari, then **Share** → **Add to Home Screen**.

If Google shows "Sorry, unable to open the file", Safari is signed into more than one Google account. Add `/u/0/` or `/u/1/` after `/macros` in the link, or sign out of the other accounts.

## Settings worth checking

- **Auto-cleanup** is on by default. Open **Settings** → **Preview what would be deleted** before the first daily run.
- Scan time and timezone are set at the top of `Code.gs` (`SCAN_HOUR`, `TIMEZONE`).
