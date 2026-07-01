use crate::model::{LogEntry, LogLevel};
use chrono::{Datelike, NaiveDate, NaiveDateTime};
use regex::Regex;
use std::collections::BTreeMap;
use std::sync::OnceLock;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LogFormat {
    AndroidThreadtime,
    PlainText,
}

pub fn parse_line(line_number: usize, raw: &str) -> LogEntry {
    parse_android_threadtime(line_number, raw).unwrap_or_else(|| parse_plain(line_number, raw))
}

fn parse_android_threadtime(line_number: usize, raw: &str) -> Option<LogEntry> {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| {
        Regex::new(
            r"^(?P<month>\d{2})-(?P<day>\d{2})\s+(?P<time>\d{2}:\d{2}:\d{2}\.\d{3})\s+(?P<pid>\d+)\s+(?P<tid>\d+)\s+(?P<level>[VDIWEF])\s+(?P<tag>[^:]+):\s?(?P<message>.*)$",
        )
        .expect("android threadtime regex must compile")
    });
    let caps = re.captures(raw)?;
    let year = chrono::Local::now().year();
    let timestamp = parse_android_timestamp(year, &caps["month"], &caps["day"], &caps["time"]);
    Some(LogEntry {
        line_number,
        timestamp,
        level: LogLevel::from_android_priority(&caps["level"]),
        pid: caps["pid"].parse().ok(),
        tid: caps["tid"].parse().ok(),
        tag: Some(caps["tag"].trim().to_string()),
        message: caps["message"].to_string(),
        raw: raw.to_string(),
        fields: BTreeMap::new(),
    })
}

fn parse_android_timestamp(year: i32, month: &str, day: &str, time: &str) -> Option<NaiveDateTime> {
    let month = month.parse().ok()?;
    let day = day.parse().ok()?;
    let date = NaiveDate::from_ymd_opt(year, month, day)?;
    let value = format!("{} {}", date.format("%Y-%m-%d"), time);
    NaiveDateTime::parse_from_str(&value, "%Y-%m-%d %H:%M:%S%.3f").ok()
}

fn parse_plain(line_number: usize, raw: &str) -> LogEntry {
    LogEntry {
        line_number,
        timestamp: None,
        level: infer_plain_level(raw),
        pid: None,
        tid: None,
        tag: None,
        message: raw.to_string(),
        raw: raw.to_string(),
        fields: BTreeMap::new(),
    }
}

fn infer_plain_level(raw: &str) -> LogLevel {
    let lower = raw.to_ascii_lowercase();
    if lower.contains("fatal") {
        LogLevel::Fatal
    } else if lower.contains("error") || lower.contains("exception") {
        LogLevel::Error
    } else if lower.contains("warn") {
        LogLevel::Warn
    } else if lower.contains("debug") {
        LogLevel::Debug
    } else if lower.contains("info") {
        LogLevel::Info
    } else {
        LogLevel::Unknown
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_android_threadtime() {
        let entry = parse_line(
            1,
            "07-01 15:30:12.123  1234  5678 E AndroidRuntime: FATAL EXCEPTION: main",
        );
        assert_eq!(entry.level, LogLevel::Error);
        assert_eq!(entry.pid, Some(1234));
        assert_eq!(entry.tid, Some(5678));
        assert_eq!(entry.tag.as_deref(), Some("AndroidRuntime"));
        assert!(entry.message.contains("FATAL EXCEPTION"));
    }
}
