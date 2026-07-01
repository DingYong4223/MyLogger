use crate::analyze::AnalysisSummary;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReportFormat {
    Text,
    Markdown,
    Json,
}

pub fn generate_markdown_report(summary: &AnalysisSummary) -> String {
    let mut out = String::new();
    out.push_str("# MyLogger 分析报告\n\n");
    out.push_str("## 摘要\n\n");
    out.push_str(&format!("- 总行数：{}\n", summary.total_lines));
    out.push_str(&format!("- 命中行数：{}\n", summary.matched_lines));
    out.push_str(&format!("- 发现问题：{}\n\n", summary.issues.len()));

    out.push_str("## 日志级别统计\n\n");
    if summary.level_counts.is_empty() {
        out.push_str("- 无\n\n");
    } else {
        for (level, count) in &summary.level_counts {
            out.push_str(&format!("- {}：{}\n", level, count));
        }
        out.push('\n');
    }

    out.push_str("## Top Tag\n\n");
    if summary.top_tags.is_empty() {
        out.push_str("- 无\n\n");
    } else {
        for (tag, count) in &summary.top_tags {
            out.push_str(&format!("- `{}`：{}\n", tag, count));
        }
        out.push('\n');
    }

    out.push_str("## 问题列表\n\n");
    if summary.issues.is_empty() {
        out.push_str("未发现明确 Crash、Exception 或 ANR 线索。\n");
    } else {
        for (index, issue) in summary.issues.iter().enumerate() {
            out.push_str(&format!(
                "### {}. {} ({:?})\n\n",
                index + 1,
                issue.title,
                issue.issue_type
            ));
            out.push_str(&format!(
                "- 严重程度：{:?}\n- 行号：{}-{}\n",
                issue.severity, issue.first_line, issue.last_line
            ));
            if let Some(suggestion) = issue.suggestion.as_deref() {
                out.push_str(&format!("- 建议：{}\n", suggestion));
            }
            out.push_str("\n```text\n");
            for line in &issue.evidence {
                out.push_str(line);
                out.push('\n');
            }
            out.push_str("```\n\n");
        }
    }
    out
}
