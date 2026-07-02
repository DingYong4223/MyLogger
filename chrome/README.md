# MyLogger Chrome Extension

This Chrome extension provides a local log viewer UI.

## Load

1. Run `npm install` from this `chrome/` directory if dependencies are not installed.
2. Run `npm run build` to generate `dist/viewer.bundle.js`.
3. Open `chrome://extensions`.
4. Enable `Developer mode`.
5. Click `Load unpacked`.
6. Select this repository's `chrome/` directory.
7. Click the MyLogger extension icon and choose `Open Viewer`.

## Features

- Open a local log file with file picker or drag and drop.
- Display logs in columns: line, time, level, tag, message.
- Filter visible logs by keyword or regex.
- Search visible logs and jump between matches.
- Open search matches in an in-page results dialog with the `Search` button.
- Highlight log time, level, tag, and search terms.
- Use native horizontal and vertical scrollbars.
- Double-click any row to copy the original line.
- Save filtered results as a `.filtered.txt` file.
- POST the selected log path and breakpoint JSON content to a backend analysis endpoint and show the returned result in an in-page dialog.

## Backend Analysis API

The default endpoint is:

```text
http://127.0.0.1:7878/analyze
```

Start the demo backend from the repository root:

```bash
python3 backend/analysis_server.py
```

The extension sends JSON:

```json
{
  "fileName": "123.txt",
  "filePath": "123.txt",
  "breakpointsFileName": "mylogger-breakpoints.json",
  "breakpointsContent": "{...}",
  "visibleLineCount": 100,
  "filter": "error"
}
```

Log paths are resolved by the backend. Relative paths are resolved from the directory where the backend service was started.
