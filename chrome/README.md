# MyLogger Chrome Extension

This Chrome extension provides a local log viewer UI.

## Load

1. Open `chrome://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select this repository's `chrome/` directory.
5. Click the MyLogger extension icon and choose `Open Viewer`.

## Features

- Open a local log file with file picker or drag and drop.
- Display logs in columns: line, time, level, tag, message.
- Filter visible logs by keyword or regex.
- Search visible logs and jump between matches.
- Open search matches in an in-page results dialog with the `Search` button.
- Highlight log time, level, tag, and search terms.
- Use native horizontal and vertical scrollbars.
- Click any row to copy the original line.
- Save filtered results as a `.filtered.log` file.
- POST the selected log path to a backend analysis endpoint and show the returned result in an in-page dialog.

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
  "visibleLineCount": 100,
  "filter": "error"
}
```

Chrome does not reliably expose the absolute path of a file selected with the file picker. Set the `Log Path` field to a path the backend can read. Relative paths are resolved from the directory where the backend service was started.
