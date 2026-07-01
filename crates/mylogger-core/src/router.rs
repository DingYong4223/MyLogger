#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Intent {
    Capture { time_named: bool },
    Analyze { path: Option<String> },
    FilterError,
    Report,
    Device,
    CommandPalette,
    Help,
    Quit,
    Unknown,
}

pub fn route_intent(input: &str) -> Intent {
    let text = input.trim();
    let lower = text.to_ascii_lowercase();
    if text.is_empty() {
        return Intent::Unknown;
    }
    if text == "/" {
        return Intent::CommandPalette;
    }
    if matches!(lower.as_str(), "quit" | "exit" | "/quit" | "/exit") {
        return Intent::Quit;
    }
    if lower == "/help" || lower == "help" || text == "帮助" {
        return Intent::Help;
    }
    if lower.starts_with("/device") || text.contains("设备") {
        return Intent::Device;
    }
    if lower.starts_with("capture -t")
        || lower.starts_with("/capture -t")
        || text.contains("时间命名")
    {
        return Intent::Capture { time_named: true };
    }
    if lower.starts_with("/capture")
        || lower == "capture"
        || text.contains("抓取")
        || text.contains("抓日志")
    {
        return Intent::Capture { time_named: false };
    }
    if lower.starts_with("/report") || text.contains("报告") || text.contains("导出") {
        return Intent::Report;
    }
    if text.contains("只看 Error")
        || lower.contains("only error")
        || lower.contains("filter error")
        || lower == "/filter error"
    {
        return Intent::FilterError;
    }
    if lower.starts_with("/analyze") {
        let path = text.split_whitespace().nth(1).map(ToString::to_string);
        return Intent::Analyze { path };
    }
    if text.contains("分析") || text.contains("崩溃") || lower.contains("crash") {
        return Intent::Analyze { path: None };
    }
    Intent::Unknown
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn routes_capture_aliases() {
        assert_eq!(
            route_intent("抓取日志"),
            Intent::Capture { time_named: false }
        );
        assert_eq!(
            route_intent("capture -t"),
            Intent::Capture { time_named: true }
        );
        assert_eq!(
            route_intent("/capture -t"),
            Intent::Capture { time_named: true }
        );
    }

    #[test]
    fn routes_command_palette() {
        assert_eq!(route_intent("/"), Intent::CommandPalette);
    }
}
