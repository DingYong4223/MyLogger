# Chrome Web Store Publishing

This checklist is for publishing the MyLogger Chrome extension to the Chrome Web Store.

## 1. Register Developer Account

Use the Chrome Web Store Developer Dashboard:

https://chrome.google.com/webstore/devconsole/

Before publishing, register as a Chrome Web Store developer and pay the one-time developer registration fee.

Reference:

- https://developer.chrome.com/docs/webstore/register

## 2. Prepare Extension Package

Build the extension bundle before packaging:

```bash
cd chrome
npm run build
```

Create a zip that contains only runtime extension files. Do not include development files or generated local artifacts.

Include:

- `manifest.json`
- `popup.html`
- `popup.js`
- `viewer.html`
- `viewer.css`
- `dist/viewer.bundle.js`
- `icons/icon16.png`
- `icons/icon32.png`
- `icons/icon48.png`
- `icons/icon128.png`

Do not include:

- `node_modules/`
- `package.json`
- `package-lock.json`
- `.DS_Store`
- temporary logs or captured text files
- local development notes

Example:

```bash
cd chrome
zip -r ../mylogger-chrome-extension.zip \
  manifest.json popup.html popup.js viewer.html viewer.css dist icons \
  -x "*.DS_Store"
```

## 3. Check Manifest

Required and important fields:

- `manifest_version`: must be `3`.
- `name`: currently `MyLogger`.
- `description`: concise explanation of local log viewing and filtering.
- `version`: increment before every store update.
- `icons`: include `16`, `32`, `48`, and `128` PNG icons.
- `permissions`: explain why each permission is needed in the store submission.
- `host_permissions`: keep local-service access limited to localhost URLs.

Current permission explanations:

- `downloads`: saves filtered logs and analysis results as text files.
- `clipboardWrite`: copies log lines when the user double-clicks a row.
- `http://localhost/*`, `http://127.0.0.1/*`: sends breakpoint JSON content to the user-run local MyLogger backend service.

## 4. Prepare Store Listing

In the Developer Dashboard, create a new item and upload the zip.

Reference:

- https://developer.chrome.com/docs/webstore/publish

Store listing materials to prepare:

- Extension name: `MyLogger`
- Short description
- Detailed description
- Category
- Language
- Screenshots
- 128x128 icon
- Privacy policy URL
- Support contact or support URL
- Permission justification text
- Data usage disclosure
- Distribution regions
- Visibility setting

## 5. Privacy Notes

Recommended privacy statement points:

- MyLogger opens log files selected by the user.
- Log files are processed locally in the browser extension.
- Breakpoint JSON content is sent only to the configured local MyLogger backend service.
- The extension does not send logs or breakpoint files to third-party servers.
- Saved files are created only when the user clicks save/export actions.
- Clipboard writes happen only when the user triggers copy behavior.

## 6. Submit For Review

After completing the listing and privacy sections, submit the item for review. If rejected, update the package or listing according to the review feedback and resubmit.

For future updates:

1. Increment `version` in `chrome/manifest.json`.
2. Run `npm run build`.
3. Recreate the zip.
4. Upload the new package in Developer Dashboard.
