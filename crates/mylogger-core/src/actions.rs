use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActionId {
    Devices,
    DeviceInfo,
    Apps,
    AppInfo,
    Install,
    Start,
    Stop,
    Restart,
    Current,
    Schema,
    Log,
    CaptureClear,
    CaptureTimed,
    Logcat,
    Screenshot,
    Push,
    Pull,
    Reverse,
    Forward,
    Favorites,
    History,
    Tasks,
    Analyze,
    StartService,
    Help,
    Quit,
}

pub struct ActionSpec {
    pub id: ActionId,
    pub title: &'static str,
    pub command: &'static str,
    pub category: &'static str,
    pub needs_device: bool,
    pub needs_package: bool,
}

macro_rules! action {
    ($id:ident,$title:literal,$command:literal,$category:literal,$device:literal,$package:literal) => {
        ActionSpec {
            id: ActionId::$id,
            title: $title,
            command: $command,
            category: $category,
            needs_device: $device,
            needs_package: $package,
        }
    };
}

pub static ACTIONS: &[ActionSpec] = &[
    action!(Devices, "选择设备", "/device", "设备", false, false),
    action!(DeviceInfo, "设备信息", "/device-info", "设备", true, false),
    action!(Apps, "选择应用", "/apps", "应用", true, false),
    action!(AppInfo, "应用信息", "/app-info", "应用", true, true),
    action!(Install, "安装 APK", "/install", "应用", true, false),
    action!(Start, "启动应用", "/start", "应用", true, true),
    action!(Stop, "停止应用", "/stop", "应用", true, true),
    action!(Restart, "重启应用", "/restart", "应用", true, true),
    action!(Current, "当前 Activity", "/current", "应用", true, false),
    action!(Schema, "打开 schema", "/schema", "页面", true, false),
    action!(Log, "采集应用日志", "/log", "日志", true, false),
    action!(
        CaptureClear,
        "清空并抓取日志",
        "/clear & logcat",
        "日志",
        true,
        false
    ),
    action!(
        CaptureTimed,
        "清空并抓取（时间命名）",
        "/clear & logcat -t",
        "日志",
        true,
        false
    ),
    action!(
        Logcat,
        "采集设备日志（不清空）",
        "/logcat",
        "日志",
        true,
        false
    ),
    action!(Screenshot, "设备截图", "/screenshot", "媒体", true, false),
    action!(Push, "上传文件 Push", "/push", "文件", true, false),
    action!(Pull, "下载文件 Pull", "/pull", "文件", true, false),
    action!(
        Reverse,
        "设备访问电脑 Reverse",
        "/reverse",
        "网络",
        true,
        false
    ),
    action!(
        Forward,
        "电脑访问设备 Forward",
        "/forward",
        "网络",
        true,
        false
    ),
    action!(Favorites, "schema 收藏", "/favorites", "会话", false, false),
    action!(History, "执行历史", "/history", "会话", false, false),
    action!(Tasks, "任务与产物", "/tasks", "会话", false, false),
    action!(Analyze, "分析本地日志", "/analyze", "日志", false, false),
    action!(
        StartService,
        "启动分析服务",
        "/StartService",
        "日志",
        false,
        false
    ),
    action!(Help, "帮助", "/help", "会话", false, false),
    action!(Quit, "退出", "/quit", "会话", false, false),
];

pub fn find_action(input: &str) -> Option<ActionId> {
    let input = input.trim();
    if input == "/打开schema" {
        return Some(ActionId::Schema);
    }
    ACTIONS
        .iter()
        .find(|a| a.command.eq_ignore_ascii_case(input))
        .map(|a| a.id)
}

pub fn search_actions(query: &str) -> Vec<&'static ActionSpec> {
    let q = query.trim().trim_start_matches('/').to_lowercase();
    ACTIONS
        .iter()
        .filter(|a| {
            q.is_empty()
                || format!("{} {} {}", a.title, a.command, a.category)
                    .to_lowercase()
                    .replace(' ', "")
                    .contains(&q.replace(' ', ""))
        })
        .collect()
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum TaskStatus {
    Running,
    Saving,
    Success,
    Failed,
    Cancelled,
}

impl TaskStatus {
    pub fn label(self) -> &'static str {
        match self {
            Self::Running => "运行中",
            Self::Saving => "保存中",
            Self::Success => "已完成",
            Self::Failed => "失败",
            Self::Cancelled => "已取消",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OperationResult {
    pub title: String,
    pub device: Option<String>,
    pub package: Option<String>,
    pub status: TaskStatus,
    pub command: String,
    pub output: String,
    pub elapsed_ms: u128,
    pub exit_code: Option<i32>,
    pub artifacts: Vec<PathBuf>,
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn searches_chinese_and_english_and_preserves_schema_alias() {
        assert!(
            search_actions("设备")
                .iter()
                .any(|a| a.id == ActionId::Devices)
        );
        assert_eq!(search_actions("/SCREENSHOT")[0].id, ActionId::Screenshot);
        assert_eq!(find_action("/打开schema"), Some(ActionId::Schema));
        assert!(find_action("demo://schema").is_none());
    }
}
