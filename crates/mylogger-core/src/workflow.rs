#[derive(Debug, Clone)]
pub struct Workflow {
    pub id: &'static str,
    pub title: &'static str,
    pub aliases: &'static [&'static str],
}

pub fn builtin_workflows() -> Vec<Workflow> {
    vec![
        Workflow {
            id: "capture",
            title: "抓取 Android 日志",
            aliases: &["capture", "抓取", "抓日志", "logcat"],
        },
        Workflow {
            id: "start-service",
            title: "启动本地日志后台服务",
            aliases: &[
                "StartService",
                "start-service",
                "service",
                "启动服务",
                "日志服务",
            ],
        },
        Workflow {
            id: "crash",
            title: "崩溃分析",
            aliases: &["crash", "崩溃", "闪退", "fatal", "FATAL EXCEPTION"],
        },
        Workflow {
            id: "anr",
            title: "ANR 分析",
            aliases: &["anr", "卡死", "无响应", "卡顿"],
        },
        Workflow {
            id: "report",
            title: "生成 Markdown 报告",
            aliases: &["report", "报告", "导出"],
        },
    ]
}
