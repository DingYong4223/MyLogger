---
name: my-logger
description: Analyze, view, browse, inspect, open, or filter Android, app, server, or CLI logs to find root causes, timelines, recurring error patterns, severity, and next debugging steps. Use when the user provides log files, logcat output, stack traces, crash/ANR snippets, startup failures, network failures, performance logs, asks to summarize/filter/explain logs, or asks to open/view/browse/inspect/read a log file, including Chinese intents like "查看日志", "打开日志", "浏览日志", or "查阅日志".
---

# My Logger

## Workflow

1. Identify the log source, time range, app/package/process names, device context, and the user's symptom. If missing, infer from filenames and log content before asking.
2. Preserve evidence. Quote only short log lines that matter, and include file path plus line number when available.
3. Build a timeline around the first meaningful failure, not the last repeated symptom.
4. Classify signals:
   - Crash: `FATAL EXCEPTION`, `AndroidRuntime`, native tombstone, signal, abort, uncaught exception.
   - ANR or hang: `ANR in`, `Input dispatching timed out`, main-thread stalls, binder timeout.
   - Startup: Activity launch, Application init, dependency loading, permission/provider failures.
   - Network: HTTP status, timeout, DNS, TLS, request IDs, retry storms.
   - Storage or permission: `EACCES`, `Permission denied`, scoped storage, missing provider authority.
   - Business flow: user-provided keywords, order/session/request IDs, feature tags.
5. Separate root cause from collateral noise. Prefer the earliest causal error with a stack trace, request ID, or direct state transition.
6. Report confidence. Mark uncertain conclusions as hypotheses and state what evidence would confirm them.

## Analysis Output

Use this shape unless the user asks for a different format:

```text
结论:
- ...

关键证据:
- path:line message

时间线:
- time event

可能原因:
- ...

建议动作:
- ...
```

For large logs, first run targeted searches before reading broad sections:

```bash
rg -n "FATAL EXCEPTION|AndroidRuntime|ANR in|Exception|Error|timeout|denied|failed|crash|abort|signal" <log-file>
rg -n "<package>|<process>|<request-id>|<keyword>" <log-file>
```

When using MyLogger outputs, treat `mylogger-analysis.md` as a generated analysis artifact, not source evidence unless the user explicitly asks to review the prior analysis.

## Android Logcat Guidance

Read [references/android-log-patterns.md](references/android-log-patterns.md) when analyzing Android logcat, crash, ANR, or performance logs.

## View Logs

Read [references/view-log.md](references/view-log.md) when the user asks to view, open, inspect, browse, read, or check a log file. Chinese intents such as "查看日志", "打开日志", "浏览日志", and "查阅日志" must route here.

## Filter Logs

Read [references/filter-log.md](references/filter-log.md) when the user asks to filter a log file by keyword and view only matching lines.

## Neovim Highlighting

Read [references/neovim-log-highlighting.md](references/neovim-log-highlighting.md) whenever MyLogger opens logs or filtered logs in Neovim.
