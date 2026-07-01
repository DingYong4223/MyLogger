use crate::model::{Issue, IssueSeverity, IssueType, LogEntry, LogLevel};
use crate::parser::parse_line;
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs::File;
use std::io::{BufRead, BufReader, Read};
use std::path::Path;

#[derive(Debug, Clone, Default)]
pub struct AnalysisOptions {
    pub keyword: Option<String>,
    pub min_level: Option<LogLevel>,
    pub tag: Option<String>,
    pub pid: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalysisSummary {
    pub total_lines: usize,
    pub matched_lines: usize,
    pub level_counts: BTreeMap<String, usize>,
    pub top_tags: Vec<(String, usize)>,
    pub issues: Vec<Issue>,
    pub matched_entries: Vec<LogEntry>,
}

pub fn analyze_file(path: impl AsRef<Path>, options: &AnalysisOptions) -> Result<AnalysisSummary> {
    let file = File::open(path.as_ref())
        .with_context(|| format!("failed to open {}", path.as_ref().display()))?;
    analyze_reader(file, options)
}

pub fn analyze_reader(reader: impl Read, options: &AnalysisOptions) -> Result<AnalysisSummary> {
    let mut total_lines = 0;
    let mut entries = Vec::new();

    for line in BufReader::new(reader).lines() {
        total_lines += 1;
        let line = line.with_context(|| format!("failed to read line {}", total_lines))?;
        let entry = parse_line(total_lines, &line);
        if matches_options(&entry, options) {
            entries.push(entry);
        }
    }

    let level_counts = count_levels(&entries);
    let top_tags = top_tags(&entries, 10);
    let issues = extract_issues(&entries);

    Ok(AnalysisSummary {
        total_lines,
        matched_lines: entries.len(),
        level_counts,
        top_tags,
        issues,
        matched_entries: entries,
    })
}

fn matches_options(entry: &LogEntry, options: &AnalysisOptions) -> bool {
    if !entry.level.matches_filter(options.min_level) {
        return false;
    }

    if let Some(keyword) = options.keyword.as_deref()
        && !entry
            .raw
            .to_ascii_lowercase()
            .contains(&keyword.to_ascii_lowercase())
    {
        return false;
    }

    if let Some(tag) = options.tag.as_deref()
        && entry.tag.as_deref() != Some(tag)
    {
        return false;
    }

    if let Some(pid) = options.pid
        && entry.pid != Some(pid)
    {
        return false;
    }

    true
}

fn count_levels(entries: &[LogEntry]) -> BTreeMap<String, usize> {
    let mut counts = BTreeMap::new();
    for entry in entries {
        *counts.entry(entry.level.to_string()).or_insert(0) += 1;
    }
    counts
}

fn top_tags(entries: &[LogEntry], limit: usize) -> Vec<(String, usize)> {
    let mut counts = BTreeMap::new();
    for entry in entries {
        if let Some(tag) = entry.tag.as_ref() {
            *counts.entry(tag.clone()).or_insert(0usize) += 1;
        }
    }
    let mut items: Vec<_> = counts.into_iter().collect();
    items.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    items.truncate(limit);
    items
}

fn extract_issues(entries: &[LogEntry]) -> Vec<Issue> {
    let mut issues = Vec::new();
    let mut index = 0;
    while index < entries.len() {
        let entry = &entries[index];
        if is_crash_line(entry) || is_exception_line(entry) {
            let start = index;
            let mut end = index;
            while end + 1 < entries.len() && is_issue_continuation(entry, &entries[end + 1]) {
                end += 1;
            }
            let evidence = entries[start..=end]
                .iter()
                .take(24)
                .map(|item| item.raw.clone())
                .collect();
            issues.push(Issue {
                issue_type: if is_crash_line(entry) {
                    IssueType::Crash
                } else {
                    IssueType::Exception
                },
                severity: if is_crash_line(entry) {
                    IssueSeverity::Critical
                } else {
                    IssueSeverity::High
                },
                title: issue_title(entry),
                first_line: entries[start].line_number,
                last_line: entries[end].line_number,
                evidence,
                suggestion: Some(
                    "先定位首个异常栈和业务触发点，再结合前后上下文确认根因。".to_string(),
                ),
            });
            index = end + 1;
            continue;
        }

        if is_anr_line(entry) {
            issues.push(Issue {
                issue_type: IssueType::Anr,
                severity: IssueSeverity::High,
                title: "可能的 ANR / 无响应日志".to_string(),
                first_line: entry.line_number,
                last_line: entry.line_number,
                evidence: vec![entry.raw.clone()],
                suggestion: Some(
                    "继续查看主线程堆栈、锁等待和 Input dispatching timed out 前后的日志。"
                        .to_string(),
                ),
            });
        }

        index += 1;
    }
    issues
}

fn is_crash_line(entry: &LogEntry) -> bool {
    entry.raw.contains("FATAL EXCEPTION")
        || entry.tag.as_deref() == Some("AndroidRuntime")
            && matches!(entry.level, LogLevel::Error | LogLevel::Fatal)
}

fn is_exception_line(entry: &LogEntry) -> bool {
    entry.raw.contains("Exception")
        || entry.raw.contains("Throwable")
        || entry.raw.contains("java.lang.")
        || entry.raw.contains("kotlin.")
}

fn is_anr_line(entry: &LogEntry) -> bool {
    let lower = entry.raw.to_ascii_lowercase();
    lower.contains(" anr")
        || lower.contains("application not responding")
        || lower.contains("input dispatching timed out")
}

fn is_stack_continuation(entry: &LogEntry) -> bool {
    let trimmed = entry.message.trim_start();
    trimmed.starts_with("at ")
        || trimmed.starts_with("Caused by:")
        || trimmed.starts_with("Suppressed:")
        || trimmed.starts_with("... ")
        || entry.raw.contains("\tat ")
}

fn is_issue_continuation(root: &LogEntry, next: &LogEntry) -> bool {
    is_stack_continuation(next)
        || root.tag.as_deref() == Some("AndroidRuntime")
            && next.tag.as_deref() == Some("AndroidRuntime")
            && (is_exception_line(next) || next.level == LogLevel::Error)
}

fn issue_title(entry: &LogEntry) -> String {
    let text = entry.message.trim();
    if text.is_empty() {
        "日志异常".to_string()
    } else {
        text.chars().take(120).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_crash_stack() {
        let input = "\
07-01 15:30:12.123  1234  5678 E AndroidRuntime: FATAL EXCEPTION: main
07-01 15:30:12.124  1234  5678 E AndroidRuntime: java.lang.IllegalStateException: boom
07-01 15:30:12.125  1234  5678 E AndroidRuntime: \tat com.example.Main.onCreate(Main.kt:10)
";
        let summary = analyze_reader(input.as_bytes(), &AnalysisOptions::default()).unwrap();
        assert_eq!(summary.total_lines, 3);
        assert_eq!(summary.issues.len(), 1);
        assert!(matches!(summary.issues[0].issue_type, IssueType::Crash));
    }
}
