use chrono::NaiveDateTime;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum LogLevel {
    Trace,
    Debug,
    Info,
    Warn,
    Error,
    Fatal,
    Unknown,
}

impl LogLevel {
    pub fn from_android_priority(value: &str) -> Self {
        match value {
            "V" => Self::Trace,
            "D" => Self::Debug,
            "I" => Self::Info,
            "W" => Self::Warn,
            "E" => Self::Error,
            "F" => Self::Fatal,
            _ => Self::Unknown,
        }
    }

    pub fn matches_filter(self, min: Option<LogLevel>) -> bool {
        let Some(min) = min else {
            return true;
        };
        severity_rank(self) >= severity_rank(min)
    }
}

fn severity_rank(level: LogLevel) -> u8 {
    match level {
        LogLevel::Trace => 0,
        LogLevel::Debug => 1,
        LogLevel::Info => 2,
        LogLevel::Warn => 3,
        LogLevel::Error => 4,
        LogLevel::Fatal => 5,
        LogLevel::Unknown => 0,
    }
}

impl std::fmt::Display for LogLevel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let text = match self {
            LogLevel::Trace => "TRACE",
            LogLevel::Debug => "DEBUG",
            LogLevel::Info => "INFO",
            LogLevel::Warn => "WARN",
            LogLevel::Error => "ERROR",
            LogLevel::Fatal => "FATAL",
            LogLevel::Unknown => "UNKNOWN",
        };
        f.write_str(text)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogEntry {
    pub line_number: usize,
    pub timestamp: Option<NaiveDateTime>,
    pub level: LogLevel,
    pub pid: Option<u32>,
    pub tid: Option<u32>,
    pub tag: Option<String>,
    pub message: String,
    pub raw: String,
    pub fields: BTreeMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum IssueType {
    Crash,
    Anr,
    Exception,
    Performance,
    Custom,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum IssueSeverity {
    Low,
    Medium,
    High,
    Critical,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Issue {
    pub issue_type: IssueType,
    pub severity: IssueSeverity,
    pub title: String,
    pub first_line: usize,
    pub last_line: usize,
    pub evidence: Vec<String>,
    pub suggestion: Option<String>,
}
