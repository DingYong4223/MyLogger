use anyhow::{Context, Result};
use crossterm::{
    event::{self, Event, KeyCode, KeyEventKind, KeyModifiers},
    execute,
    terminal::{EnterAlternateScreen, LeaveAlternateScreen, disable_raw_mode, enable_raw_mode},
};
use mylogger_core::{
    AnalysisOptions, AnalysisSummary, Intent, analyze_file, generate_markdown_report, route_intent,
};
use mylogger_tools::{
    CaptureOptions, StartServiceOptions, capture_logcat, open_schema, select_device,
    start_backend_service,
};
use ratatui::{
    Terminal,
    backend::CrosstermBackend,
    layout::{Constraint, Layout, Rect},
    style::{Color, Modifier, Style},
    text::Line,
    widgets::{Block, Borders, Clear, List, ListItem, Paragraph, Wrap},
};
use std::io::{self, IsTerminal, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use unicode_width::UnicodeWidthStr;

#[derive(Debug, Default)]
pub struct SessionState {
    pub selected_device: Option<String>,
    pub current_log_file: Option<PathBuf>,
    pub last_capture_file: Option<PathBuf>,
}

#[derive(Debug, Default)]
struct UiState {
    input: String,
    cursor: usize,
    input_scroll: usize,
    awaiting_schema: bool,
    input_history: Vec<InputHistoryEntry>,
    history_index: Option<usize>,
    history_draft: InputHistoryEntry,
}

#[derive(Debug, Clone, Default)]
struct InputHistoryEntry {
    input: String,
    is_schema: bool,
}

mod workbench;

pub fn run_repl() -> Result<()> {
    if !io::stdin().is_terminal() {
        return run_line_repl();
    }
    workbench::run()
}

impl UiState {
    fn clear_input(&mut self) {
        self.input.clear();
        self.cursor = 0;
        self.input_scroll = 0;
        self.history_index = None;
        self.history_draft = InputHistoryEntry::default();
    }

    fn remember_input(&mut self, input: String, is_schema: bool) {
        if !is_schema && matches!(route_intent(normalize_command(&input)), Intent::OpenSchema) {
            return;
        }
        self.input_history
            .push(InputHistoryEntry { input, is_schema });
    }

    fn navigate_history(&mut self, older: bool) {
        if self.input_history.is_empty() {
            return;
        }
        let next = if older {
            match self.history_index {
                None => {
                    self.history_draft = InputHistoryEntry {
                        input: self.input.clone(),
                        is_schema: self.awaiting_schema,
                    };
                    Some(self.input_history.len() - 1)
                }
                Some(index) => Some(index.saturating_sub(1)),
            }
        } else {
            match self.history_index {
                Some(index) if index + 1 < self.input_history.len() => Some(index + 1),
                Some(_) => None,
                None => return,
            }
        };
        let entry = match next {
            Some(index) => &self.input_history[index],
            None => &self.history_draft,
        };
        self.input = entry.input.clone();
        self.awaiting_schema = entry.is_schema;
        self.cursor = self.input.chars().count();
        self.input_scroll = 0;
        self.history_index = next;
    }

    fn input_view(&mut self, width: u16) -> (&str, u16) {
        if width == 0 {
            return ("", 0);
        }
        let cursor = byte_index_at_char(&self.input, self.cursor);
        self.input_scroll = if UnicodeWidthStr::width(&self.input[..cursor]) < usize::from(width) {
            0
        } else {
            self.input_scroll.min(cursor)
        };
        while !self.input.is_char_boundary(self.input_scroll) {
            self.input_scroll -= 1;
        }
        if UnicodeWidthStr::width(&self.input[self.input_scroll..cursor]) >= usize::from(width) {
            self.input_scroll = cursor;
            for (start, _) in self.input[..cursor].char_indices().rev() {
                if UnicodeWidthStr::width(&self.input[start..cursor]) >= usize::from(width) {
                    break;
                }
                self.input_scroll = start;
            }
        }
        let cursor_column = UnicodeWidthStr::width(&self.input[self.input_scroll..cursor]) as u16;
        (&self.input[self.input_scroll..], cursor_column)
    }

    fn insert_char(&mut self, ch: char) {
        let byte_index = byte_index_at_char(&self.input, self.cursor);
        self.input.insert(byte_index, ch);
        self.cursor += 1;
    }

    fn backspace(&mut self) {
        if self.cursor == 0 {
            return;
        }
        let start = byte_index_at_char(&self.input, self.cursor - 1);
        let end = byte_index_at_char(&self.input, self.cursor);
        self.input.replace_range(start..end, "");
        self.cursor -= 1;
    }

    fn delete(&mut self) {
        if self.cursor >= self.input.chars().count() {
            return;
        }
        let start = byte_index_at_char(&self.input, self.cursor);
        let end = byte_index_at_char(&self.input, self.cursor + 1);
        self.input.replace_range(start..end, "");
    }

    fn move_left(&mut self) {
        self.cursor = self.cursor.saturating_sub(1);
    }

    fn move_right(&mut self) {
        self.cursor = (self.cursor + 1).min(self.input.chars().count());
    }

    fn move_home(&mut self) {
        self.cursor = 0;
    }

    fn move_end(&mut self) {
        self.cursor = self.input.chars().count();
    }
}

struct TerminalSession {
    terminal: Terminal<CrosstermBackend<io::Stdout>>,
    active: bool,
}

impl TerminalSession {
    fn enter() -> Result<Self> {
        enable_raw_mode().context("failed to enable raw mode")?;
        let mut stdout = io::stdout();
        execute!(stdout, EnterAlternateScreen).context("failed to enter alternate screen")?;
        let backend = CrosstermBackend::new(stdout);
        let terminal = Terminal::new(backend).context("failed to create terminal")?;
        Ok(Self {
            terminal,
            active: true,
        })
    }

    fn draw<F>(&mut self, f: F) -> Result<()>
    where
        F: FnOnce(&mut ratatui::Frame<'_>),
    {
        self.terminal.draw(f).context("failed to draw ui")?;
        Ok(())
    }

    fn suspend(&mut self) -> Result<()> {
        if self.active {
            disable_raw_mode().context("failed to disable raw mode")?;
            execute!(self.terminal.backend_mut(), LeaveAlternateScreen)
                .context("failed to leave alternate screen")?;
            self.active = false;
        }
        Ok(())
    }

    fn resume(&mut self) -> Result<()> {
        if !self.active {
            enable_raw_mode().context("failed to enable raw mode")?;
            execute!(self.terminal.backend_mut(), EnterAlternateScreen)
                .context("failed to enter alternate screen")?;
            self.terminal
                .clear()
                .context("failed to clear terminal after resume")?;
            self.active = true;
        }
        Ok(())
    }

    fn leave(mut self) -> Result<()> {
        self.suspend()
    }
}

impl Drop for TerminalSession {
    fn drop(&mut self) {
        if self.active {
            let _ = disable_raw_mode();
            let _ = execute!(self.terminal.backend_mut(), LeaveAlternateScreen);
        }
    }
}

fn previous_index(index: usize, len: usize) -> usize {
    if len == 0 {
        0
    } else if index == 0 {
        len - 1
    } else {
        index - 1
    }
}

fn next_index(index: usize, len: usize) -> usize {
    if len == 0 { 0 } else { (index + 1) % len }
}

fn centered_rect(area: Rect, percent_x: u16, height: u16) -> Rect {
    let preferred_width = area.width.saturating_mul(percent_x).saturating_div(100);
    let width = if area.width >= 48 {
        preferred_width.clamp(48, area.width)
    } else {
        area.width
    };
    let height = if area.height >= 5 {
        height.clamp(3, area.height.saturating_sub(2))
    } else {
        area.height
    };
    Rect {
        x: area.x + area.width.saturating_sub(width) / 2,
        y: area.y + area.height.saturating_sub(height) / 2,
        width,
        height,
    }
}

fn menu_popup_area(frame_area: Rect, input_area: Rect, preferred_height: u16) -> Rect {
    let space_below = frame_area.bottom().saturating_sub(input_area.bottom());
    let space_above = input_area.y.saturating_sub(frame_area.y);
    let open_below = space_below >= preferred_height || space_below >= space_above;
    let available = if open_below { space_below } else { space_above };
    let height = preferred_height.min(available);
    let y = if open_below {
        input_area.bottom()
    } else {
        input_area.y.saturating_sub(height)
    };

    Rect {
        x: input_area.x,
        y,
        width: input_area.width,
        height,
    }
}

fn set_input_cursor(frame: &mut ratatui::Frame<'_>, area: Rect, cursor_column: u16) {
    if area.width < 5 || area.height < 3 {
        return;
    }
    let x = area
        .x
        .saturating_add(3)
        .saturating_add(cursor_column)
        .min(area.x.saturating_add(area.width.saturating_sub(2)));
    let y = area.y.saturating_add(1);
    frame.set_cursor_position((x, y));
}

fn byte_index_at_char(text: &str, char_index: usize) -> usize {
    if char_index == 0 {
        return 0;
    }
    text.char_indices()
        .nth(char_index)
        .map(|(index, _)| index)
        .unwrap_or(text.len())
}

fn run_line_repl() -> Result<()> {
    let mut session = SessionState::default();
    print_welcome_for_line_mode();
    loop {
        print!("MyLogger> ");
        io::stdout().flush().ok();
        let mut input = String::new();
        let bytes = io::stdin()
            .read_line(&mut input)
            .context("failed to read input")?;
        if bytes == 0 {
            println!();
            break;
        }
        let input = input.trim();
        if input.is_empty() {
            continue;
        }

        if let Err(err) = handle_input(input, &mut session) {
            eprintln!("error: {err:#}");
        }
    }
    Ok(())
}

fn execute_tui_analyze_open(
    terminal: &mut TerminalSession,
    path: Option<String>,
    session: &mut SessionState,
) -> Result<String> {
    let path = match path {
        Some(path) => PathBuf::from(path),
        None => select_log_file_with_yazi(Some(terminal))?,
    };
    let summary = analyze_file(&path, &AnalysisOptions::default())?;
    session.current_log_file = Some(path.clone());
    let report_path = write_analysis_markdown(&path, &summary)?;
    open_file_with_nvim(Some(terminal), &report_path)?;
    Ok(format!(
        "{}\n\n分析结果已用 Neovim 打开：{}",
        format_summary(&path, &summary),
        report_path.display()
    ))
}

fn drain_pending_terminal_events(max_duration: Duration) {
    let started = Instant::now();
    while started.elapsed() < max_duration {
        match event::poll(Duration::from_millis(25)) {
            Ok(true) => {
                let _ = event::read();
            }
            Ok(false) => break,
            Err(_) => break,
        }
    }
}

fn start_service_text() -> Result<String> {
    let result = start_backend_service(&StartServiceOptions::default())?;
    let status = if result.already_running {
        "服务已在运行".to_string()
    } else if let Some(pid) = result.pid {
        format!("服务已启动，pid {pid}")
    } else {
        "服务已启动".to_string()
    };
    Ok(format!(
        "{status}\n接口：{}\n工作目录：{}",
        result.endpoint,
        result.repo_root.display()
    ))
}

fn normalize_command(command: &str) -> &str {
    match command {
        "1" => "capture",
        "2" => "/analyze",
        "3" => "分析崩溃",
        "4" => "/StartService",
        other => other,
    }
}

fn format_summary(path: &Path, summary: &mylogger_core::AnalysisSummary) -> String {
    let mut out = String::new();
    out.push_str(&format!("分析文件：{}\n", path.display()));
    out.push_str(&format!("总行数：{}\n", summary.total_lines));
    out.push_str(&format!("命中行数：{}\n", summary.matched_lines));
    out.push_str(&format!("发现问题：{}\n", summary.issues.len()));
    if !summary.level_counts.is_empty() {
        out.push_str("级别统计：\n");
        for (level, count) in &summary.level_counts {
            out.push_str(&format!("  {level}: {count}\n"));
        }
    }
    if !summary.top_tags.is_empty() {
        out.push_str("Top Tag：\n");
        for (tag, count) in &summary.top_tags {
            out.push_str(&format!("  {tag}: {count}\n"));
        }
    }
    for issue in summary.issues.iter().take(5) {
        out.push_str(&format!(
            "- [{:?}] {} (line {}-{})\n",
            issue.issue_type, issue.title, issue.first_line, issue.last_line
        ));
    }
    out.trim_end().to_string()
}

fn print_welcome_for_line_mode() {
    println!("MyLogger");
    println!();
    println!("常用操作：");
    println!("[1] 抓取 Android 日志");
    println!("[2] 分析本地日志文件");
    println!("[3] 提取崩溃");
    println!("[4] 启动本地日志后台服务");
    println!();
    println!("请输入编号、命令或自然语言。输入 / 查看命令，/quit 退出。");
}

fn handle_input(input: &str, session: &mut SessionState) -> Result<()> {
    let normalized = match input {
        "1" => "capture",
        "2" => "/analyze",
        "3" => "分析崩溃",
        "4" => "/StartService",
        other => other,
    };

    match route_intent(normalized) {
        Intent::Capture {
            time_named,
            clear_before_capture,
        } => {
            let output = capture_logcat(&CaptureOptions {
                device: session.selected_device.clone(),
                time_named,
                clear_before_capture,
                ..Default::default()
            })?;
            session.last_capture_file = Some(output.clone());
            session.current_log_file = Some(output);
        }
        Intent::Analyze { path, open } => {
            let path = resolve_log_path(path, session)?;
            let summary = analyze_file(&path, &AnalysisOptions::default())?;
            session.current_log_file = Some(path.clone());
            print_summary(&path, &summary);
            if open {
                let report_path = write_analysis_markdown(&path, &summary)?;
                open_file_with_nvim(None, &report_path)?;
            }
        }
        Intent::StartService => {
            println!("{}", start_service_text()?);
        }
        Intent::OpenSchema => {
            let device = select_device(None)?;
            session.selected_device = Some(device.serial);
            loop {
                print!("请输入schema（Enter 打开，Esc 取消）：");
                io::stdout().flush().ok();
                let mut schema = String::new();
                if io::stdin()
                    .read_line(&mut schema)
                    .context("failed to read schema")?
                    == 0
                    || schema.trim() == "\u{1b}"
                {
                    println!("已取消打开schema。");
                    break;
                }
                let schema = schema.trim();
                if schema.is_empty() {
                    println!("schema不能为空。");
                    continue;
                }
                println!(
                    "{}",
                    open_schema(schema, session.selected_device.as_deref())?
                );
                break;
            }
        }
        Intent::CommandPalette => print_command_palette(),
        Intent::Help => print_help(),
        Intent::Quit => {
            println!("bye");
            std::process::exit(0);
        }
        Intent::Unknown => {
            println!("暂未识别该请求。可尝试：抓取日志、分析 app.log、/help。");
        }
    }
    Ok(())
}

fn resolve_log_path(path: Option<String>, session: &SessionState) -> Result<PathBuf> {
    if let Some(path) = path {
        return Ok(PathBuf::from(path));
    }
    select_log_file_with_yazi(None).or_else(|_| {
        if let Some(path) = session.current_log_file.as_ref() {
            return Ok(path.clone());
        }
        if let Some(path) = session.last_capture_file.as_ref() {
            return Ok(path.clone());
        }
        anyhow::bail!("请安装 yazi，或指定日志文件路径，例如：/analyze app.log")
    })
}

fn select_log_file_with_yazi(mut terminal: Option<&mut TerminalSession>) -> Result<PathBuf> {
    let chooser_file = std::env::temp_dir().join(format!(
        "mylogger-yazi-choice-{}-{}.txt",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    ));
    let _ = std::fs::remove_file(&chooser_file);

    if let Some(terminal) = terminal.as_deref_mut() {
        terminal.suspend()?;
    }
    println!("MyLogger 已打开 yazi，请选择日志文件。");

    let status = Command::new("yazi")
        .arg("--chooser-file")
        .arg(&chooser_file)
        .status();

    if let Some(terminal) = terminal {
        terminal.resume()?;
        drain_pending_terminal_events(Duration::from_millis(300));
    }

    let status =
        status.context("failed to start yazi; please install yazi and ensure it is in PATH")?;
    if !status.success() {
        anyhow::bail!("yazi exited with status {status}");
    }

    let selected = std::fs::read_to_string(&chooser_file).unwrap_or_default();
    let _ = std::fs::remove_file(&chooser_file);
    let selected = selected
        .lines()
        .next()
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .context("未选择日志文件")?;
    Ok(PathBuf::from(selected))
}

fn write_analysis_markdown(path: &Path, summary: &AnalysisSummary) -> Result<PathBuf> {
    let directory = std::env::current_dir()?;
    let mut output = directory.join("mylogger-analysis.md");
    if output.exists() {
        output = mylogger_tools::operations::unique_output(&directory, "mylogger-analysis", "md")?;
    }
    let mut report = String::new();
    report.push_str(&format!("> 分析文件：{}\n\n", path.display()));
    report.push_str(&generate_markdown_report(summary));
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&output)
        .with_context(|| format!("failed to create {}", output.display()))?;
    file.write_all(report.as_bytes())?;
    Ok(output)
}

fn open_file_with_nvim(mut terminal: Option<&mut TerminalSession>, path: &Path) -> Result<()> {
    if let Some(terminal) = terminal.as_deref_mut() {
        terminal.suspend()?;
    }

    let status = Command::new("nvim").arg(path).status();

    if let Some(terminal) = terminal {
        terminal.resume()?;
        drain_pending_terminal_events(Duration::from_millis(300));
    }

    let status =
        status.context("failed to start nvim; please install Neovim and ensure it is in PATH")?;
    if !status.success() {
        anyhow::bail!("nvim exited with status {status}");
    }
    Ok(())
}

fn print_summary(path: &Path, summary: &mylogger_core::AnalysisSummary) {
    println!("分析文件：{}", path.display());
    println!("总行数：{}", summary.total_lines);
    println!("命中行数：{}", summary.matched_lines);
    println!("发现问题：{}", summary.issues.len());
    if !summary.level_counts.is_empty() {
        println!("级别统计：");
        for (level, count) in &summary.level_counts {
            println!("  {level}: {count}");
        }
    }
    if !summary.top_tags.is_empty() {
        println!("Top Tag：");
        for (tag, count) in &summary.top_tags {
            println!("  {tag}: {count}");
        }
    }
    for issue in summary.issues.iter().take(5) {
        println!(
            "- [{:?}] {} (line {}-{})",
            issue.issue_type, issue.title, issue.first_line, issue.last_line
        );
    }
}

fn print_help() {
    println!("可用输入：");
    println!("  /                 打开命令菜单");
    println!("  /clear & logcat          清空并抓取日志，默认写入 ./123.txt，Ctrl+C 结束");
    println!("  /clear & logcat -t       清空并抓取日志，写入 mylogger-YYYYMMDD-HHMMSS.log");
    println!("  /logcat                  直接抓取日志，不清空历史日志");
    println!("  /StartService     启动本地日志后台服务");
    println!("  /打开schema       输入schema并通过adb打开");
    println!("  /quit             退出");
}

fn print_command_palette() {
    println!("支持的命令：");
    for item in mylogger_core::actions::ACTIONS {
        println!("  {:<16} {}", item.command, item.title);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn history_recalls_schema_commands_and_draft() {
        let mut ui = UiState::default();
        ui.remember_input("/打开schema".into(), false);
        assert!(ui.input_history.is_empty());
        ui.remember_input("demo://中文?value=1".into(), true);
        ui.remember_input("/help".into(), false);
        ui.input = "草稿".into();
        ui.navigate_history(true);
        assert_eq!(ui.input, "/help");
        assert!(!ui.awaiting_schema);
        ui.navigate_history(true);
        assert_eq!(ui.input, "demo://中文?value=1");
        assert!(ui.awaiting_schema);
        ui.navigate_history(true);
        assert_eq!(ui.input, "demo://中文?value=1");
        ui.navigate_history(false);
        assert_eq!(ui.input, "/help");
        ui.navigate_history(false);
        assert_eq!(ui.input, "草稿");
        assert!(!ui.awaiting_schema);
    }
    #[test]
    fn long_input_scrolls_with_cursor_and_preserves_text() {
        let mut ui = UiState::default();
        for ch in "0123456789".chars() {
            ui.insert_char(ch);
        }
        assert_eq!(ui.input_view(6), ("56789", 5));
        ui.move_left();
        assert_eq!(ui.input_view(6), ("56789", 4));
        ui.move_home();
        assert_eq!(ui.input_view(6), ("0123456789", 0));
        ui.move_end();
        assert_eq!(ui.input_view(3), ("89", 2));
        assert_eq!(ui.input, "0123456789");
    }
    #[test]
    fn unicode_editing_and_tiny_viewports() {
        let mut ui = UiState::default();
        for ch in "中文ab".chars() {
            ui.insert_char(ch);
        }
        assert_eq!(ui.input_view(5), ("文ab", 4));
        ui.move_home();
        ui.delete();
        ui.move_end();
        ui.backspace();
        assert_eq!(ui.input_view(5), ("文a", 3));
        assert_eq!(ui.input_view(0), ("", 0));
        assert_eq!(ui.input_view(1), ("", 0));
    }
    #[test]
    fn popup_stays_inside_terminal() {
        assert_eq!(
            menu_popup_area(Rect::new(0, 0, 80, 30), Rect::new(0, 27, 80, 3), 8),
            Rect::new(0, 19, 80, 8)
        );
        assert_eq!(
            menu_popup_area(Rect::new(0, 0, 80, 7), Rect::new(0, 4, 80, 3), 8),
            Rect::new(0, 0, 80, 4)
        );
    }
}
