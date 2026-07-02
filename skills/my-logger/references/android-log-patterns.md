# Android Log Patterns

## Crash

Prioritize the first `FATAL EXCEPTION` block for Java/Kotlin crashes. Capture:

- process and package
- thread name
- exception class and message
- top app-owned stack frame
- caused-by chain

For native crashes, look for `signal`, `pid`, `tid`, `backtrace`, `abort message`, and `.so` names. Treat the first app/native library frame as stronger evidence than framework cleanup lines.

## ANR

Look for `ANR in`, `Input dispatching timed out`, `BroadcastQueue`, `Service timeout`, or `ContentProvider not responding`. Extract:

- blocked component
- main thread state
- binder or lock owner if present
- heavy work before the ANR timestamp

ANR evidence is strongest when a main-thread stack, trace file excerpt, or repeated slow operation appears near the ANR.

## Startup Failures

Search for activity/application lifecycle and package manager lines:

```bash
rg -n "ActivityTaskManager|ActivityManager|Application|Unable to start|ClassNotFoundException|InflateException|SecurityException" <log-file>
```

Common causes include missing activity declarations, provider init failure, dependency injection failure, layout inflation failure, multidex/class loading, and permission denial.

## Network Failures

Group lines by request ID, URL path, trace ID, or business ID. Distinguish:

- client timeout
- DNS failure
- TLS/SSL failure
- HTTP non-2xx response
- server business error code
- retry loop or duplicate request

Report both transport-level and business-level errors when both exist.

## Performance and Jank

Look for frame drops, slow dispatch, GC storms, binder latency, IO on main thread, and repeated expensive logs. Avoid claiming root cause from a single slow line unless it aligns with the user's symptom timestamp.

## Noise Filtering

Treat these as noise unless they correlate with the failure:

- unrelated package names
- repeated warning spam after the crash
- framework cleanup after process death
- benign hidden API warnings
- network retries after the first failing request
