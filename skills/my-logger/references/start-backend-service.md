# Start Backend Analysis Service

Use this workflow when the user asks to start the MyLogger backend analysis service for the Chrome extension or wants to test "Backend Analysis".

## Demo Service

Start the local demo server from the repository root:

```bash
python3 backend/analysis_server.py
```

The service listens on:

```text
http://127.0.0.1:7878/analyze
```

## Chrome Extension Flow

1. Open the MyLogger Chrome viewer.
2. Open a log file.
3. In `Backend Analysis`, set `Log Path` to a path readable by the backend service.
4. Click `Analyze Visible Logs`.
5. The Chrome extension sends `filePath` to the service and opens a result dialog with the returned JSON.

Chrome cannot reliably expose the absolute local file path selected by the user. If the `Log Path` field contains only a filename such as `123.txt`, the backend resolves it relative to the directory where `python3 backend/analysis_server.py` was started.

## Current Demo Result

The demo reads the log file and returns:

- absolute path
- line count
- word count
- character count
- filter and visible-line metadata passed by the plugin

Use `Ctrl+C` in the terminal to stop the service.
