#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Intent {
    Capture { time_named: bool },
    Analyze { path: Option<String>, open: bool },
    StartService,
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
    if matches!(
        lower.as_str(),
        "/startservice" | "startservice" | "/start-service" | "start-service" | "service"
    ) || text.contains("启动服务")
        || text.contains("日志服务")
    {
        return Intent::StartService;
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
    if lower.starts_with("/analyze") {
        let mut open = false;
        let mut path = None;
        for token in text.split_whitespace().skip(1) {
            if token == "--open" {
                open = true;
            } else if path.is_none() {
                path = Some(token.to_string());
            }
        }
        return Intent::Analyze { path, open };
    }
    if text.contains("分析") || text.contains("崩溃") || lower.contains("crash") {
        return Intent::Analyze {
            path: None,
            open: false,
        };
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

    #[test]
    fn routes_analyze_open() {
        assert_eq!(
            route_intent("/analyze --open"),
            Intent::Analyze {
                path: None,
                open: true
            }
        );
        assert_eq!(
            route_intent("/analyze app.log --open"),
            Intent::Analyze {
                path: Some("app.log".to_string()),
                open: true
            }
        );
    }

    #[test]
    fn routes_start_service() {
        assert_eq!(route_intent("StartService"), Intent::StartService);
        assert_eq!(route_intent("/start-service"), Intent::StartService);
        assert_eq!(route_intent("启动日志服务"), Intent::StartService);
    }
}
