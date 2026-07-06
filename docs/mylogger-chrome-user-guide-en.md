# MyLogger Chrome Extension User Guide

## Overview

MyLogger is a local log viewer for developers, testers, and troubleshooting workflows. It opens local log files in Chrome and supports filtering, searching, context inspection, line marking, result saving, reusable filter management, and breakpoint-based log rule extraction from JSON files.

The extension is mainly designed for Android, backend service, and client-side log analysis. Normal log viewing and filtering run locally in the browser. Breakpoint log extraction is optional and requires a local MyLogger backend service.

## Key Features

- Open common text files such as `.log`, `.txt`, `.json`, `.md`, `.csv`, `.xml`, and `.yaml`.
- Parse time, level, tag, and message columns when possible; unsupported columns remain empty while the original content stays visible.
- Filter logs by keyword, multi-line OR rules, regular expressions, and case-sensitive matching.
- Filter by time range, log level, and exact tag matching.
- Search within current results and further filter search result windows.
- Open a log context window from result rows to inspect nearby logs with the selected row highlighted.
- Mark log lines, view marked rows, jump between marks, and jump to a specific line number.
- Double-click a log row to copy its text.
- Save filtered results, search results, and screening results as `.txt` files by default.
- Add, edit, delete, drag-sort, import, and export reusable common filters.
- Keep the latest 20 filter history records.
- Switch between English and Chinese.
- Back up and restore user configuration.

## Basic Usage

After installing the extension, click the MyLogger icon in the Chrome toolbar, then click "Open Viewer" to open the main page. You can click "Open Text/Log" to choose a local log file, or drag a file directly into the page.

After a file is loaded, logs are displayed in a table with line number, time, level, tag, and message columns. Long lines do not wrap by default and can be viewed with horizontal scrolling. The line number column remains fixed while scrolling, which makes large logs easier to inspect. MyLogger uses virtual rendering to reduce lag when viewing large files.

## Filtering And Searching

The top Filter field filters the main log view. You can enter a normal keyword or multiple lines of rules. Multiple lines use OR logic, so a row is shown when it matches any rule. When Regex is enabled, each line is treated as an independent regular expression. When Case sensitive is enabled, matching becomes case-sensitive.

The Search field finds text within the current visible results. Clicking Search opens a search results window, where you can further filter the result list. Clicking a search result opens the log context window and shows nearby logs.

When the Filter field has content, a View button appears on the right. Clicking it opens the screening results window. The left side shows filter rules, and the right side shows matching logs from the current file with line numbers preserved.

## Time, Level, And Tag Filters

Click the Time header to open the time range selector. Choose a start and end time to show only logs within that range.

Click the Level header to choose one or more log levels, such as `V`, `D`, `I`, `W`, `E`, and `F`.

Click the Tag header to enter one or more tags, then click Confirm to apply. Tags use exact matching. Multiple tags use OR logic.

## Marks, Jump, And Context

You can mark important log lines and use "All Marks" to view all marked rows. The up and down arrows jump between marked lines. The Jump button lets you enter a line number and jump directly to that row.

Clicking a row in filtered results, search results, or screening results opens the log context window. The context window shows nearby logs around the selected row and highlights the target row. This is useful for checking requests, state changes, retries, or stack traces before and after an error.

## Common Filters And Filter History

The Common Filters section on the left stores frequently used filter rules. You can add a title and a group of filter terms, then apply them later to replace the top Filter field. Common filters support editing, deletion, drag sorting, import, and export, which makes them easy to share across devices or team members.

MyLogger records recently used filters and keeps the latest 20 history items. Duplicate records are moved to the newest position, and the oldest records are removed automatically when the limit is exceeded.

## Import And Breakpoint Logs

When the Filter field is empty, the button on the right shows Import. Click it to import a local filter log file, or choose a breakpoint JSON file exported from an Android Studio plugin and use the local MyLogger backend service to extract log strings from source lines related to breakpoints.

Breakpoint log workflow:

1. Start the local MyLogger backend service.
2. Open a log file in the extension.
3. Click Import.
4. Confirm the service URL. The default is `http://127.0.0.1:7878/analyze`.
5. Choose a breakpoint JSON file.
6. Click Get Breakpoint Logs.
7. The returned log strings are filled into the Filter field and used to filter the current log file.

This feature is mainly for Android troubleshooting. Normal log file content is not sent to the backend through this feature. The backend receives only the selected breakpoint JSON content and uses local source files to extract log rules.

## Tools

The Tools entry on the left opens a packaged local tools page. It provides common text utilities such as JSON formatting, parameter processing, and QR code generation. The page is bundled with the extension and does not depend on an external website.

## User Settings

The settings button in the top-right corner opens the User Settings page. You can manage the service URL, language, common filters, and filter history in one place.

The settings page supports configuration backup and restore. Backup exports a JSON file containing the service URL, language, common filters, and filter history. Restore imports that JSON file and writes the configuration back into the extension.

## Privacy

MyLogger mainly processes local log files selected by the user. Normal opening, viewing, filtering, searching, marking, context inspection, and saving happen locally in the browser.

The extension does not proactively upload log files to third-party servers. Only when the user explicitly uses Get Breakpoint Logs does the extension send the selected breakpoint JSON content to the configured local service URL. The default URL is `http://127.0.0.1:7878/analyze`.

The extension uses browser local storage to save language, service URL, common filters, and filter history. Users can back up, restore, or clear related configuration from the settings page.

## FAQ

### Why are time, level, or tag columns empty for some rows?

Log formats vary by source. MyLogger tries to parse common formats, but unsupported columns remain empty. The original row content is still visible and searchable.

### Why do saved results include line numbers when reopened?

Saved results keep line numbers so users can trace rows back to their original locations. MyLogger supports reopening text files that already include line numbers.

### Why is Save Filtered disabled?

The button is disabled when no filter is active, which prevents accidentally saving an entire log file. Enter a filter condition to enable saving filtered results.

### Why does Get Breakpoint Logs fail?

Check that the local service is running, the service URL is correct, the breakpoint JSON file is valid, and the backend service can access the corresponding source code files.
